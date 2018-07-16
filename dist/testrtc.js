(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var SDPUtils = require('sdp');

function fixStatsType(stat) {
  return {
    inboundrtp: 'inbound-rtp',
    outboundrtp: 'outbound-rtp',
    candidatepair: 'candidate-pair',
    localcandidate: 'local-candidate',
    remotecandidate: 'remote-candidate'
  }[stat.type] || stat.type;
}

function writeMediaSection(transceiver, caps, type, stream, dtlsRole) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : dtlsRole || 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    var trackId = transceiver.rtpSender._initialTrackId ||
        transceiver.rtpSender.track.id;
    transceiver.rtpSender._initialTrackId = trackId;
    // spec.
    var msid = 'msid:' + (stream ? stream.id : '-') + ' ' +
        trackId + '\r\n';
    sdp += 'a=' + msid;
    // for Chrome. Legacy should no longer be required.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;

    // RTX
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
}

// Edge does not like
// 1) stun: filtered after 14393 unless ?transport=udp is present
// 2) turn: that does not have all of turn:host:port?transport=udp
// 3) turn: with ipv6 addresses
// 4) turn: occurring muliple times
function filterIceServers(iceServers, edgeVersion) {
  var hasTurn = false;
  iceServers = JSON.parse(JSON.stringify(iceServers));
  return iceServers.filter(function(server) {
    if (server && (server.urls || server.url)) {
      var urls = server.urls || server.url;
      if (server.url && !server.urls) {
        console.warn('RTCIceServer.url is deprecated! Use urls instead.');
      }
      var isString = typeof urls === 'string';
      if (isString) {
        urls = [urls];
      }
      urls = urls.filter(function(url) {
        var validTurn = url.indexOf('turn:') === 0 &&
            url.indexOf('transport=udp') !== -1 &&
            url.indexOf('turn:[') === -1 &&
            !hasTurn;

        if (validTurn) {
          hasTurn = true;
          return true;
        }
        return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
            url.indexOf('?transport=udp') === -1;
      });

      delete server.url;
      server.urls = isString ? urls[0] : urls;
      return !!urls.length;
    }
  });
}

// Determines the intersection of local and remote capabilities.
function getCommonCapabilities(localCapabilities, remoteCapabilities) {
  var commonCapabilities = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: []
  };

  var findCodecByPayloadType = function(pt, codecs) {
    pt = parseInt(pt, 10);
    for (var i = 0; i < codecs.length; i++) {
      if (codecs[i].payloadType === pt ||
          codecs[i].preferredPayloadType === pt) {
        return codecs[i];
      }
    }
  };

  var rtxCapabilityMatches = function(lRtx, rRtx, lCodecs, rCodecs) {
    var lCodec = findCodecByPayloadType(lRtx.parameters.apt, lCodecs);
    var rCodec = findCodecByPayloadType(rRtx.parameters.apt, rCodecs);
    return lCodec && rCodec &&
        lCodec.name.toLowerCase() === rCodec.name.toLowerCase();
  };

  localCapabilities.codecs.forEach(function(lCodec) {
    for (var i = 0; i < remoteCapabilities.codecs.length; i++) {
      var rCodec = remoteCapabilities.codecs[i];
      if (lCodec.name.toLowerCase() === rCodec.name.toLowerCase() &&
          lCodec.clockRate === rCodec.clockRate) {
        if (lCodec.name.toLowerCase() === 'rtx' &&
            lCodec.parameters && rCodec.parameters.apt) {
          // for RTX we need to find the local rtx that has a apt
          // which points to the same local codec as the remote one.
          if (!rtxCapabilityMatches(lCodec, rCodec,
              localCapabilities.codecs, remoteCapabilities.codecs)) {
            continue;
          }
        }
        rCodec = JSON.parse(JSON.stringify(rCodec)); // deepcopy
        // number of channels is the highest common number of channels
        rCodec.numChannels = Math.min(lCodec.numChannels,
            rCodec.numChannels);
        // push rCodec so we reply with offerer payload type
        commonCapabilities.codecs.push(rCodec);

        // determine common feedback mechanisms
        rCodec.rtcpFeedback = rCodec.rtcpFeedback.filter(function(fb) {
          for (var j = 0; j < lCodec.rtcpFeedback.length; j++) {
            if (lCodec.rtcpFeedback[j].type === fb.type &&
                lCodec.rtcpFeedback[j].parameter === fb.parameter) {
              return true;
            }
          }
          return false;
        });
        // FIXME: also need to determine .parameters
        //  see https://github.com/openpeer/ortc/issues/569
        break;
      }
    }
  });

  localCapabilities.headerExtensions.forEach(function(lHeaderExtension) {
    for (var i = 0; i < remoteCapabilities.headerExtensions.length;
         i++) {
      var rHeaderExtension = remoteCapabilities.headerExtensions[i];
      if (lHeaderExtension.uri === rHeaderExtension.uri) {
        commonCapabilities.headerExtensions.push(rHeaderExtension);
        break;
      }
    }
  });

  // FIXME: fecMechanisms
  return commonCapabilities;
}

// is action=setLocalDescription with type allowed in signalingState
function isActionAllowedInSignalingState(action, type, signalingState) {
  return {
    offer: {
      setLocalDescription: ['stable', 'have-local-offer'],
      setRemoteDescription: ['stable', 'have-remote-offer']
    },
    answer: {
      setLocalDescription: ['have-remote-offer', 'have-local-pranswer'],
      setRemoteDescription: ['have-local-offer', 'have-remote-pranswer']
    }
  }[type][action].indexOf(signalingState) !== -1;
}

function maybeAddCandidate(iceTransport, candidate) {
  // Edge's internal representation adds some fields therefore
  // not all fieldѕ are taken into account.
  var alreadyAdded = iceTransport.getRemoteCandidates()
      .find(function(remoteCandidate) {
        return candidate.foundation === remoteCandidate.foundation &&
            candidate.ip === remoteCandidate.ip &&
            candidate.port === remoteCandidate.port &&
            candidate.priority === remoteCandidate.priority &&
            candidate.protocol === remoteCandidate.protocol &&
            candidate.type === remoteCandidate.type;
      });
  if (!alreadyAdded) {
    iceTransport.addRemoteCandidate(candidate);
  }
  return !alreadyAdded;
}


function makeError(name, description) {
  var e = new Error(description);
  e.name = name;
  // legacy error codes from https://heycam.github.io/webidl/#idl-DOMException-error-names
  e.code = {
    NotSupportedError: 9,
    InvalidStateError: 11,
    InvalidAccessError: 15,
    TypeError: undefined,
    OperationError: undefined
  }[name];
  return e;
}

module.exports = function(window, edgeVersion) {
  // https://w3c.github.io/mediacapture-main/#mediastream
  // Helper function to add the track to the stream and
  // dispatch the event ourselves.
  function addTrackToStreamAndFireEvent(track, stream) {
    stream.addTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('addtrack',
        {track: track}));
  }

  function removeTrackFromStreamAndFireEvent(track, stream) {
    stream.removeTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('removetrack',
        {track: track}));
  }

  function fireAddTrack(pc, track, receiver, streams) {
    var trackEvent = new Event('track');
    trackEvent.track = track;
    trackEvent.receiver = receiver;
    trackEvent.transceiver = {receiver: receiver};
    trackEvent.streams = streams;
    window.setTimeout(function() {
      pc._dispatchEvent('track', trackEvent);
    });
  }

  var RTCPeerConnection = function(config) {
    var pc = this;

    var _eventTarget = document.createDocumentFragment();
    ['addEventListener', 'removeEventListener', 'dispatchEvent']
        .forEach(function(method) {
          pc[method] = _eventTarget[method].bind(_eventTarget);
        });

    this.canTrickleIceCandidates = null;

    this.needNegotiation = false;

    this.localStreams = [];
    this.remoteStreams = [];

    this._localDescription = null;
    this._remoteDescription = null;

    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.iceGatheringState = 'new';

    config = JSON.parse(JSON.stringify(config || {}));

    this.usingBundle = config.bundlePolicy === 'max-bundle';
    if (config.rtcpMuxPolicy === 'negotiate') {
      throw(makeError('NotSupportedError',
          'rtcpMuxPolicy \'negotiate\' is not supported'));
    } else if (!config.rtcpMuxPolicy) {
      config.rtcpMuxPolicy = 'require';
    }

    switch (config.iceTransportPolicy) {
      case 'all':
      case 'relay':
        break;
      default:
        config.iceTransportPolicy = 'all';
        break;
    }

    switch (config.bundlePolicy) {
      case 'balanced':
      case 'max-compat':
      case 'max-bundle':
        break;
      default:
        config.bundlePolicy = 'balanced';
        break;
    }

    config.iceServers = filterIceServers(config.iceServers || [], edgeVersion);

    this._iceGatherers = [];
    if (config.iceCandidatePoolSize) {
      for (var i = config.iceCandidatePoolSize; i > 0; i--) {
        this._iceGatherers.push(new window.RTCIceGatherer({
          iceServers: config.iceServers,
          gatherPolicy: config.iceTransportPolicy
        }));
      }
    } else {
      config.iceCandidatePoolSize = 0;
    }

    this._config = config;

    // per-track iceGathers, iceTransports, dtlsTransports, rtpSenders, ...
    // everything that is needed to describe a SDP m-line.
    this.transceivers = [];

    this._sdpSessionId = SDPUtils.generateSessionId();
    this._sdpSessionVersion = 0;

    this._dtlsRole = undefined; // role for a=setup to use in answers.

    this._isClosed = false;
  };

  Object.defineProperty(RTCPeerConnection.prototype, 'localDescription', {
    configurable: true,
    get: function() {
      return this._localDescription;
    }
  });
  Object.defineProperty(RTCPeerConnection.prototype, 'remoteDescription', {
    configurable: true,
    get: function() {
      return this._remoteDescription;
    }
  });

  // set up event handlers on prototype
  RTCPeerConnection.prototype.onicecandidate = null;
  RTCPeerConnection.prototype.onaddstream = null;
  RTCPeerConnection.prototype.ontrack = null;
  RTCPeerConnection.prototype.onremovestream = null;
  RTCPeerConnection.prototype.onsignalingstatechange = null;
  RTCPeerConnection.prototype.oniceconnectionstatechange = null;
  RTCPeerConnection.prototype.onconnectionstatechange = null;
  RTCPeerConnection.prototype.onicegatheringstatechange = null;
  RTCPeerConnection.prototype.onnegotiationneeded = null;
  RTCPeerConnection.prototype.ondatachannel = null;

  RTCPeerConnection.prototype._dispatchEvent = function(name, event) {
    if (this._isClosed) {
      return;
    }
    this.dispatchEvent(event);
    if (typeof this['on' + name] === 'function') {
      this['on' + name](event);
    }
  };

  RTCPeerConnection.prototype._emitGatheringStateChange = function() {
    var event = new Event('icegatheringstatechange');
    this._dispatchEvent('icegatheringstatechange', event);
  };

  RTCPeerConnection.prototype.getConfiguration = function() {
    return this._config;
  };

  RTCPeerConnection.prototype.getLocalStreams = function() {
    return this.localStreams;
  };

  RTCPeerConnection.prototype.getRemoteStreams = function() {
    return this.remoteStreams;
  };

  // internal helper to create a transceiver object.
  // (which is not yet the same as the WebRTC 1.0 transceiver)
  RTCPeerConnection.prototype._createTransceiver = function(kind, doNotAdd) {
    var hasBundleTransport = this.transceivers.length > 0;
    var transceiver = {
      track: null,
      iceGatherer: null,
      iceTransport: null,
      dtlsTransport: null,
      localCapabilities: null,
      remoteCapabilities: null,
      rtpSender: null,
      rtpReceiver: null,
      kind: kind,
      mid: null,
      sendEncodingParameters: null,
      recvEncodingParameters: null,
      stream: null,
      associatedRemoteMediaStreams: [],
      wantReceive: true
    };
    if (this.usingBundle && hasBundleTransport) {
      transceiver.iceTransport = this.transceivers[0].iceTransport;
      transceiver.dtlsTransport = this.transceivers[0].dtlsTransport;
    } else {
      var transports = this._createIceAndDtlsTransports();
      transceiver.iceTransport = transports.iceTransport;
      transceiver.dtlsTransport = transports.dtlsTransport;
    }
    if (!doNotAdd) {
      this.transceivers.push(transceiver);
    }
    return transceiver;
  };

  RTCPeerConnection.prototype.addTrack = function(track, stream) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call addTrack on a closed peerconnection.');
    }

    var alreadyExists = this.transceivers.find(function(s) {
      return s.track === track;
    });

    if (alreadyExists) {
      throw makeError('InvalidAccessError', 'Track already exists.');
    }

    var transceiver;
    for (var i = 0; i < this.transceivers.length; i++) {
      if (!this.transceivers[i].track &&
          this.transceivers[i].kind === track.kind) {
        transceiver = this.transceivers[i];
      }
    }
    if (!transceiver) {
      transceiver = this._createTransceiver(track.kind);
    }

    this._maybeFireNegotiationNeeded();

    if (this.localStreams.indexOf(stream) === -1) {
      this.localStreams.push(stream);
    }

    transceiver.track = track;
    transceiver.stream = stream;
    transceiver.rtpSender = new window.RTCRtpSender(track,
        transceiver.dtlsTransport);
    return transceiver.rtpSender;
  };

  RTCPeerConnection.prototype.addStream = function(stream) {
    var pc = this;
    if (edgeVersion >= 15025) {
      stream.getTracks().forEach(function(track) {
        pc.addTrack(track, stream);
      });
    } else {
      // Clone is necessary for local demos mostly, attaching directly
      // to two different senders does not work (build 10547).
      // Fixed in 15025 (or earlier)
      var clonedStream = stream.clone();
      stream.getTracks().forEach(function(track, idx) {
        var clonedTrack = clonedStream.getTracks()[idx];
        track.addEventListener('enabled', function(event) {
          clonedTrack.enabled = event.enabled;
        });
      });
      clonedStream.getTracks().forEach(function(track) {
        pc.addTrack(track, clonedStream);
      });
    }
  };

  RTCPeerConnection.prototype.removeTrack = function(sender) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call removeTrack on a closed peerconnection.');
    }

    if (!(sender instanceof window.RTCRtpSender)) {
      throw new TypeError('Argument 1 of RTCPeerConnection.removeTrack ' +
          'does not implement interface RTCRtpSender.');
    }

    var transceiver = this.transceivers.find(function(t) {
      return t.rtpSender === sender;
    });

    if (!transceiver) {
      throw makeError('InvalidAccessError',
          'Sender was not created by this connection.');
    }
    var stream = transceiver.stream;

    transceiver.rtpSender.stop();
    transceiver.rtpSender = null;
    transceiver.track = null;
    transceiver.stream = null;

    // remove the stream from the set of local streams
    var localStreams = this.transceivers.map(function(t) {
      return t.stream;
    });
    if (localStreams.indexOf(stream) === -1 &&
        this.localStreams.indexOf(stream) > -1) {
      this.localStreams.splice(this.localStreams.indexOf(stream), 1);
    }

    this._maybeFireNegotiationNeeded();
  };

  RTCPeerConnection.prototype.removeStream = function(stream) {
    var pc = this;
    stream.getTracks().forEach(function(track) {
      var sender = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (sender) {
        pc.removeTrack(sender);
      }
    });
  };

  RTCPeerConnection.prototype.getSenders = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpSender;
    })
    .map(function(transceiver) {
      return transceiver.rtpSender;
    });
  };

  RTCPeerConnection.prototype.getReceivers = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpReceiver;
    })
    .map(function(transceiver) {
      return transceiver.rtpReceiver;
    });
  };


  RTCPeerConnection.prototype._createIceGatherer = function(sdpMLineIndex,
      usingBundle) {
    var pc = this;
    if (usingBundle && sdpMLineIndex > 0) {
      return this.transceivers[0].iceGatherer;
    } else if (this._iceGatherers.length) {
      return this._iceGatherers.shift();
    }
    var iceGatherer = new window.RTCIceGatherer({
      iceServers: this._config.iceServers,
      gatherPolicy: this._config.iceTransportPolicy
    });
    Object.defineProperty(iceGatherer, 'state',
        {value: 'new', writable: true}
    );

    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = [];
    this.transceivers[sdpMLineIndex].bufferCandidates = function(event) {
      var end = !event.candidate || Object.keys(event.candidate).length === 0;
      // polyfill since RTCIceGatherer.state is not implemented in
      // Edge 10547 yet.
      iceGatherer.state = end ? 'completed' : 'gathering';
      if (pc.transceivers[sdpMLineIndex].bufferedCandidateEvents !== null) {
        pc.transceivers[sdpMLineIndex].bufferedCandidateEvents.push(event);
      }
    };
    iceGatherer.addEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    return iceGatherer;
  };

  // start gathering from an RTCIceGatherer.
  RTCPeerConnection.prototype._gather = function(mid, sdpMLineIndex) {
    var pc = this;
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer.onlocalcandidate) {
      return;
    }
    var bufferedCandidateEvents =
      this.transceivers[sdpMLineIndex].bufferedCandidateEvents;
    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = null;
    iceGatherer.removeEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    iceGatherer.onlocalcandidate = function(evt) {
      if (pc.usingBundle && sdpMLineIndex > 0) {
        // if we know that we use bundle we can drop candidates with
        // ѕdpMLineIndex > 0. If we don't do this then our state gets
        // confused since we dispose the extra ice gatherer.
        return;
      }
      var event = new Event('icecandidate');
      event.candidate = {sdpMid: mid, sdpMLineIndex: sdpMLineIndex};

      var cand = evt.candidate;
      // Edge emits an empty object for RTCIceCandidateComplete‥
      var end = !cand || Object.keys(cand).length === 0;
      if (end) {
        // polyfill since RTCIceGatherer.state is not implemented in
        // Edge 10547 yet.
        if (iceGatherer.state === 'new' || iceGatherer.state === 'gathering') {
          iceGatherer.state = 'completed';
        }
      } else {
        if (iceGatherer.state === 'new') {
          iceGatherer.state = 'gathering';
        }
        // RTCIceCandidate doesn't have a component, needs to be added
        cand.component = 1;
        // also the usernameFragment. TODO: update SDP to take both variants.
        cand.ufrag = iceGatherer.getLocalParameters().usernameFragment;

        var serializedCandidate = SDPUtils.writeCandidate(cand);
        event.candidate = Object.assign(event.candidate,
            SDPUtils.parseCandidate(serializedCandidate));

        event.candidate.candidate = serializedCandidate;
        event.candidate.toJSON = function() {
          return {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment
          };
        };
      }

      // update local description.
      var sections = SDPUtils.getMediaSections(pc._localDescription.sdp);
      if (!end) {
        sections[event.candidate.sdpMLineIndex] +=
            'a=' + event.candidate.candidate + '\r\n';
      } else {
        sections[event.candidate.sdpMLineIndex] +=
            'a=end-of-candidates\r\n';
      }
      pc._localDescription.sdp =
          SDPUtils.getDescription(pc._localDescription.sdp) +
          sections.join('');
      var complete = pc.transceivers.every(function(transceiver) {
        return transceiver.iceGatherer &&
            transceiver.iceGatherer.state === 'completed';
      });

      if (pc.iceGatheringState !== 'gathering') {
        pc.iceGatheringState = 'gathering';
        pc._emitGatheringStateChange();
      }

      // Emit candidate. Also emit null candidate when all gatherers are
      // complete.
      if (!end) {
        pc._dispatchEvent('icecandidate', event);
      }
      if (complete) {
        pc._dispatchEvent('icecandidate', new Event('icecandidate'));
        pc.iceGatheringState = 'complete';
        pc._emitGatheringStateChange();
      }
    };

    // emit already gathered candidates.
    window.setTimeout(function() {
      bufferedCandidateEvents.forEach(function(e) {
        iceGatherer.onlocalcandidate(e);
      });
    }, 0);
  };

  // Create ICE transport and DTLS transport.
  RTCPeerConnection.prototype._createIceAndDtlsTransports = function() {
    var pc = this;
    var iceTransport = new window.RTCIceTransport(null);
    iceTransport.onicestatechange = function() {
      pc._updateIceConnectionState();
      pc._updateConnectionState();
    };

    var dtlsTransport = new window.RTCDtlsTransport(iceTransport);
    dtlsTransport.ondtlsstatechange = function() {
      pc._updateConnectionState();
    };
    dtlsTransport.onerror = function() {
      // onerror does not set state to failed by itself.
      Object.defineProperty(dtlsTransport, 'state',
          {value: 'failed', writable: true});
      pc._updateConnectionState();
    };

    return {
      iceTransport: iceTransport,
      dtlsTransport: dtlsTransport
    };
  };

  // Destroy ICE gatherer, ICE transport and DTLS transport.
  // Without triggering the callbacks.
  RTCPeerConnection.prototype._disposeIceAndDtlsTransports = function(
      sdpMLineIndex) {
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer) {
      delete iceGatherer.onlocalcandidate;
      delete this.transceivers[sdpMLineIndex].iceGatherer;
    }
    var iceTransport = this.transceivers[sdpMLineIndex].iceTransport;
    if (iceTransport) {
      delete iceTransport.onicestatechange;
      delete this.transceivers[sdpMLineIndex].iceTransport;
    }
    var dtlsTransport = this.transceivers[sdpMLineIndex].dtlsTransport;
    if (dtlsTransport) {
      delete dtlsTransport.ondtlsstatechange;
      delete dtlsTransport.onerror;
      delete this.transceivers[sdpMLineIndex].dtlsTransport;
    }
  };

  // Start the RTP Sender and Receiver for a transceiver.
  RTCPeerConnection.prototype._transceive = function(transceiver,
      send, recv) {
    var params = getCommonCapabilities(transceiver.localCapabilities,
        transceiver.remoteCapabilities);
    if (send && transceiver.rtpSender) {
      params.encodings = transceiver.sendEncodingParameters;
      params.rtcp = {
        cname: SDPUtils.localCName,
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.recvEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.recvEncodingParameters[0].ssrc;
      }
      transceiver.rtpSender.send(params);
    }
    if (recv && transceiver.rtpReceiver && params.codecs.length > 0) {
      // remove RTX field in Edge 14942
      if (transceiver.kind === 'video'
          && transceiver.recvEncodingParameters
          && edgeVersion < 15019) {
        transceiver.recvEncodingParameters.forEach(function(p) {
          delete p.rtx;
        });
      }
      if (transceiver.recvEncodingParameters.length) {
        params.encodings = transceiver.recvEncodingParameters;
      } else {
        params.encodings = [{}];
      }
      params.rtcp = {
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.rtcpParameters.cname) {
        params.rtcp.cname = transceiver.rtcpParameters.cname;
      }
      if (transceiver.sendEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.sendEncodingParameters[0].ssrc;
      }
      transceiver.rtpReceiver.receive(params);
    }
  };

  RTCPeerConnection.prototype.setLocalDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setLocalDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set local ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var sections;
    var sessionpart;
    if (description.type === 'offer') {
      // VERY limited support for SDP munging. Limited to:
      // * changing the order of codecs
      sections = SDPUtils.splitSections(description.sdp);
      sessionpart = sections.shift();
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var caps = SDPUtils.parseRtpParameters(mediaSection);
        pc.transceivers[sdpMLineIndex].localCapabilities = caps;
      });

      pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
        pc._gather(transceiver.mid, sdpMLineIndex);
      });
    } else if (description.type === 'answer') {
      sections = SDPUtils.splitSections(pc._remoteDescription.sdp);
      sessionpart = sections.shift();
      var isIceLite = SDPUtils.matchPrefix(sessionpart,
          'a=ice-lite').length > 0;
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var transceiver = pc.transceivers[sdpMLineIndex];
        var iceGatherer = transceiver.iceGatherer;
        var iceTransport = transceiver.iceTransport;
        var dtlsTransport = transceiver.dtlsTransport;
        var localCapabilities = transceiver.localCapabilities;
        var remoteCapabilities = transceiver.remoteCapabilities;

        // treat bundle-only as not-rejected.
        var rejected = SDPUtils.isRejected(mediaSection) &&
            SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;

        if (!rejected && !transceiver.rejected) {
          var remoteIceParameters = SDPUtils.getIceParameters(
              mediaSection, sessionpart);
          var remoteDtlsParameters = SDPUtils.getDtlsParameters(
              mediaSection, sessionpart);
          if (isIceLite) {
            remoteDtlsParameters.role = 'server';
          }

          if (!pc.usingBundle || sdpMLineIndex === 0) {
            pc._gather(transceiver.mid, sdpMLineIndex);
            if (iceTransport.state === 'new') {
              iceTransport.start(iceGatherer, remoteIceParameters,
                  isIceLite ? 'controlling' : 'controlled');
            }
            if (dtlsTransport.state === 'new') {
              dtlsTransport.start(remoteDtlsParameters);
            }
          }

          // Calculate intersection of capabilities.
          var params = getCommonCapabilities(localCapabilities,
              remoteCapabilities);

          // Start the RTCRtpSender. The RTCRtpReceiver for this
          // transceiver has already been started in setRemoteDescription.
          pc._transceive(transceiver,
              params.codecs.length > 0,
              false);
        }
      });
    }

    pc._localDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-local-offer');
    } else {
      pc._updateSignalingState('stable');
    }

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.setRemoteDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setRemoteDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set remote ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var streams = {};
    pc.remoteStreams.forEach(function(stream) {
      streams[stream.id] = stream;
    });
    var receiverList = [];
    var sections = SDPUtils.splitSections(description.sdp);
    var sessionpart = sections.shift();
    var isIceLite = SDPUtils.matchPrefix(sessionpart,
        'a=ice-lite').length > 0;
    var usingBundle = SDPUtils.matchPrefix(sessionpart,
        'a=group:BUNDLE ').length > 0;
    pc.usingBundle = usingBundle;
    var iceOptions = SDPUtils.matchPrefix(sessionpart,
        'a=ice-options:')[0];
    if (iceOptions) {
      pc.canTrickleIceCandidates = iceOptions.substr(14).split(' ')
          .indexOf('trickle') >= 0;
    } else {
      pc.canTrickleIceCandidates = false;
    }

    sections.forEach(function(mediaSection, sdpMLineIndex) {
      var lines = SDPUtils.splitLines(mediaSection);
      var kind = SDPUtils.getKind(mediaSection);
      // treat bundle-only as not-rejected.
      var rejected = SDPUtils.isRejected(mediaSection) &&
          SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
      var protocol = lines[0].substr(2).split(' ')[2];

      var direction = SDPUtils.getDirection(mediaSection, sessionpart);
      var remoteMsid = SDPUtils.parseMsid(mediaSection);

      var mid = SDPUtils.getMid(mediaSection) || SDPUtils.generateIdentifier();

      // Reject datachannels which are not implemented yet.
      if ((kind === 'application' && protocol === 'DTLS/SCTP') || rejected) {
        // TODO: this is dangerous in the case where a non-rejected m-line
        //     becomes rejected.
        pc.transceivers[sdpMLineIndex] = {
          mid: mid,
          kind: kind,
          rejected: true
        };
        return;
      }

      if (!rejected && pc.transceivers[sdpMLineIndex] &&
          pc.transceivers[sdpMLineIndex].rejected) {
        // recycle a rejected transceiver.
        pc.transceivers[sdpMLineIndex] = pc._createTransceiver(kind, true);
      }

      var transceiver;
      var iceGatherer;
      var iceTransport;
      var dtlsTransport;
      var rtpReceiver;
      var sendEncodingParameters;
      var recvEncodingParameters;
      var localCapabilities;

      var track;
      // FIXME: ensure the mediaSection has rtcp-mux set.
      var remoteCapabilities = SDPUtils.parseRtpParameters(mediaSection);
      var remoteIceParameters;
      var remoteDtlsParameters;
      if (!rejected) {
        remoteIceParameters = SDPUtils.getIceParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters = SDPUtils.getDtlsParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters.role = 'client';
      }
      recvEncodingParameters =
          SDPUtils.parseRtpEncodingParameters(mediaSection);

      var rtcpParameters = SDPUtils.parseRtcpParameters(mediaSection);

      var isComplete = SDPUtils.matchPrefix(mediaSection,
          'a=end-of-candidates', sessionpart).length > 0;
      var cands = SDPUtils.matchPrefix(mediaSection, 'a=candidate:')
          .map(function(cand) {
            return SDPUtils.parseCandidate(cand);
          })
          .filter(function(cand) {
            return cand.component === 1;
          });

      // Check if we can use BUNDLE and dispose transports.
      if ((description.type === 'offer' || description.type === 'answer') &&
          !rejected && usingBundle && sdpMLineIndex > 0 &&
          pc.transceivers[sdpMLineIndex]) {
        pc._disposeIceAndDtlsTransports(sdpMLineIndex);
        pc.transceivers[sdpMLineIndex].iceGatherer =
            pc.transceivers[0].iceGatherer;
        pc.transceivers[sdpMLineIndex].iceTransport =
            pc.transceivers[0].iceTransport;
        pc.transceivers[sdpMLineIndex].dtlsTransport =
            pc.transceivers[0].dtlsTransport;
        if (pc.transceivers[sdpMLineIndex].rtpSender) {
          pc.transceivers[sdpMLineIndex].rtpSender.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
        if (pc.transceivers[sdpMLineIndex].rtpReceiver) {
          pc.transceivers[sdpMLineIndex].rtpReceiver.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
      }
      if (description.type === 'offer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex] ||
            pc._createTransceiver(kind);
        transceiver.mid = mid;

        if (!transceiver.iceGatherer) {
          transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
              usingBundle);
        }

        if (cands.length && transceiver.iceTransport.state === 'new') {
          if (isComplete && (!usingBundle || sdpMLineIndex === 0)) {
            transceiver.iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        localCapabilities = window.RTCRtpReceiver.getCapabilities(kind);

        // filter RTX until additional stuff needed for RTX is implemented
        // in adapter.js
        if (edgeVersion < 15019) {
          localCapabilities.codecs = localCapabilities.codecs.filter(
              function(codec) {
                return codec.name !== 'rtx';
              });
        }

        sendEncodingParameters = transceiver.sendEncodingParameters || [{
          ssrc: (2 * sdpMLineIndex + 2) * 1001
        }];

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        var isNewTrack = false;
        if (direction === 'sendrecv' || direction === 'sendonly') {
          isNewTrack = !transceiver.rtpReceiver;
          rtpReceiver = transceiver.rtpReceiver ||
              new window.RTCRtpReceiver(transceiver.dtlsTransport, kind);

          if (isNewTrack) {
            var stream;
            track = rtpReceiver.track;
            // FIXME: does not work with Plan B.
            if (remoteMsid && remoteMsid.stream === '-') {
              // no-op. a stream id of '-' means: no associated stream.
            } else if (remoteMsid) {
              if (!streams[remoteMsid.stream]) {
                streams[remoteMsid.stream] = new window.MediaStream();
                Object.defineProperty(streams[remoteMsid.stream], 'id', {
                  get: function() {
                    return remoteMsid.stream;
                  }
                });
              }
              Object.defineProperty(track, 'id', {
                get: function() {
                  return remoteMsid.track;
                }
              });
              stream = streams[remoteMsid.stream];
            } else {
              if (!streams.default) {
                streams.default = new window.MediaStream();
              }
              stream = streams.default;
            }
            if (stream) {
              addTrackToStreamAndFireEvent(track, stream);
              transceiver.associatedRemoteMediaStreams.push(stream);
            }
            receiverList.push([track, rtpReceiver, stream]);
          }
        } else if (transceiver.rtpReceiver && transceiver.rtpReceiver.track) {
          transceiver.associatedRemoteMediaStreams.forEach(function(s) {
            var nativeTrack = s.getTracks().find(function(t) {
              return t.id === transceiver.rtpReceiver.track.id;
            });
            if (nativeTrack) {
              removeTrackFromStreamAndFireEvent(nativeTrack, s);
            }
          });
          transceiver.associatedRemoteMediaStreams = [];
        }

        transceiver.localCapabilities = localCapabilities;
        transceiver.remoteCapabilities = remoteCapabilities;
        transceiver.rtpReceiver = rtpReceiver;
        transceiver.rtcpParameters = rtcpParameters;
        transceiver.sendEncodingParameters = sendEncodingParameters;
        transceiver.recvEncodingParameters = recvEncodingParameters;

        // Start the RTCRtpReceiver now. The RTPSender is started in
        // setLocalDescription.
        pc._transceive(pc.transceivers[sdpMLineIndex],
            false,
            isNewTrack);
      } else if (description.type === 'answer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex];
        iceGatherer = transceiver.iceGatherer;
        iceTransport = transceiver.iceTransport;
        dtlsTransport = transceiver.dtlsTransport;
        rtpReceiver = transceiver.rtpReceiver;
        sendEncodingParameters = transceiver.sendEncodingParameters;
        localCapabilities = transceiver.localCapabilities;

        pc.transceivers[sdpMLineIndex].recvEncodingParameters =
            recvEncodingParameters;
        pc.transceivers[sdpMLineIndex].remoteCapabilities =
            remoteCapabilities;
        pc.transceivers[sdpMLineIndex].rtcpParameters = rtcpParameters;

        if (cands.length && iceTransport.state === 'new') {
          if ((isIceLite || isComplete) &&
              (!usingBundle || sdpMLineIndex === 0)) {
            iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        if (!usingBundle || sdpMLineIndex === 0) {
          if (iceTransport.state === 'new') {
            iceTransport.start(iceGatherer, remoteIceParameters,
                'controlling');
          }
          if (dtlsTransport.state === 'new') {
            dtlsTransport.start(remoteDtlsParameters);
          }
        }

        pc._transceive(transceiver,
            direction === 'sendrecv' || direction === 'recvonly',
            direction === 'sendrecv' || direction === 'sendonly');

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        if (rtpReceiver &&
            (direction === 'sendrecv' || direction === 'sendonly')) {
          track = rtpReceiver.track;
          if (remoteMsid) {
            if (!streams[remoteMsid.stream]) {
              streams[remoteMsid.stream] = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams[remoteMsid.stream]);
            receiverList.push([track, rtpReceiver, streams[remoteMsid.stream]]);
          } else {
            if (!streams.default) {
              streams.default = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams.default);
            receiverList.push([track, rtpReceiver, streams.default]);
          }
        } else {
          // FIXME: actually the receiver should be created later.
          delete transceiver.rtpReceiver;
        }
      }
    });

    if (pc._dtlsRole === undefined) {
      pc._dtlsRole = description.type === 'offer' ? 'active' : 'passive';
    }

    pc._remoteDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-remote-offer');
    } else {
      pc._updateSignalingState('stable');
    }
    Object.keys(streams).forEach(function(sid) {
      var stream = streams[sid];
      if (stream.getTracks().length) {
        if (pc.remoteStreams.indexOf(stream) === -1) {
          pc.remoteStreams.push(stream);
          var event = new Event('addstream');
          event.stream = stream;
          window.setTimeout(function() {
            pc._dispatchEvent('addstream', event);
          });
        }

        receiverList.forEach(function(item) {
          var track = item[0];
          var receiver = item[1];
          if (stream.id !== item[2].id) {
            return;
          }
          fireAddTrack(pc, track, receiver, [stream]);
        });
      }
    });
    receiverList.forEach(function(item) {
      if (item[2]) {
        return;
      }
      fireAddTrack(pc, item[0], item[1], []);
    });

    // check whether addIceCandidate({}) was called within four seconds after
    // setRemoteDescription.
    window.setTimeout(function() {
      if (!(pc && pc.transceivers)) {
        return;
      }
      pc.transceivers.forEach(function(transceiver) {
        if (transceiver.iceTransport &&
            transceiver.iceTransport.state === 'new' &&
            transceiver.iceTransport.getRemoteCandidates().length > 0) {
          console.warn('Timeout for addRemoteCandidate. Consider sending ' +
              'an end-of-candidates notification');
          transceiver.iceTransport.addRemoteCandidate({});
        }
      });
    }, 4000);

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.close = function() {
    this.transceivers.forEach(function(transceiver) {
      /* not yet
      if (transceiver.iceGatherer) {
        transceiver.iceGatherer.close();
      }
      */
      if (transceiver.iceTransport) {
        transceiver.iceTransport.stop();
      }
      if (transceiver.dtlsTransport) {
        transceiver.dtlsTransport.stop();
      }
      if (transceiver.rtpSender) {
        transceiver.rtpSender.stop();
      }
      if (transceiver.rtpReceiver) {
        transceiver.rtpReceiver.stop();
      }
    });
    // FIXME: clean up tracks, local streams, remote streams, etc
    this._isClosed = true;
    this._updateSignalingState('closed');
  };

  // Update the signaling state.
  RTCPeerConnection.prototype._updateSignalingState = function(newState) {
    this.signalingState = newState;
    var event = new Event('signalingstatechange');
    this._dispatchEvent('signalingstatechange', event);
  };

  // Determine whether to fire the negotiationneeded event.
  RTCPeerConnection.prototype._maybeFireNegotiationNeeded = function() {
    var pc = this;
    if (this.signalingState !== 'stable' || this.needNegotiation === true) {
      return;
    }
    this.needNegotiation = true;
    window.setTimeout(function() {
      if (pc.needNegotiation) {
        pc.needNegotiation = false;
        var event = new Event('negotiationneeded');
        pc._dispatchEvent('negotiationneeded', event);
      }
    }, 0);
  };

  // Update the ice connection state.
  RTCPeerConnection.prototype._updateIceConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      checking: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
    });

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.checking > 0) {
      newState = 'checking';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    } else if (states.completed > 0) {
      newState = 'completed';
    }

    if (newState !== this.iceConnectionState) {
      this.iceConnectionState = newState;
      var event = new Event('iceconnectionstatechange');
      this._dispatchEvent('iceconnectionstatechange', event);
    }
  };

  // Update the connection state.
  RTCPeerConnection.prototype._updateConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      connecting: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
      states[transceiver.dtlsTransport.state]++;
    });
    // ICETransport.completed and connected are the same for this purpose.
    states.connected += states.completed;

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.connecting > 0) {
      newState = 'connecting';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    }

    if (newState !== this.connectionState) {
      this.connectionState = newState;
      var event = new Event('connectionstatechange');
      this._dispatchEvent('connectionstatechange', event);
    }
  };

  RTCPeerConnection.prototype.createOffer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createOffer after close'));
    }

    var numAudioTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'audio';
    }).length;
    var numVideoTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'video';
    }).length;

    // Determine number of audio and video tracks we need to send/recv.
    var offerOptions = arguments[0];
    if (offerOptions) {
      // Reject Chrome legacy constraints.
      if (offerOptions.mandatory || offerOptions.optional) {
        throw new TypeError(
            'Legacy mandatory/optional constraints not supported.');
      }
      if (offerOptions.offerToReceiveAudio !== undefined) {
        if (offerOptions.offerToReceiveAudio === true) {
          numAudioTracks = 1;
        } else if (offerOptions.offerToReceiveAudio === false) {
          numAudioTracks = 0;
        } else {
          numAudioTracks = offerOptions.offerToReceiveAudio;
        }
      }
      if (offerOptions.offerToReceiveVideo !== undefined) {
        if (offerOptions.offerToReceiveVideo === true) {
          numVideoTracks = 1;
        } else if (offerOptions.offerToReceiveVideo === false) {
          numVideoTracks = 0;
        } else {
          numVideoTracks = offerOptions.offerToReceiveVideo;
        }
      }
    }

    pc.transceivers.forEach(function(transceiver) {
      if (transceiver.kind === 'audio') {
        numAudioTracks--;
        if (numAudioTracks < 0) {
          transceiver.wantReceive = false;
        }
      } else if (transceiver.kind === 'video') {
        numVideoTracks--;
        if (numVideoTracks < 0) {
          transceiver.wantReceive = false;
        }
      }
    });

    // Create M-lines for recvonly streams.
    while (numAudioTracks > 0 || numVideoTracks > 0) {
      if (numAudioTracks > 0) {
        pc._createTransceiver('audio');
        numAudioTracks--;
      }
      if (numVideoTracks > 0) {
        pc._createTransceiver('video');
        numVideoTracks--;
      }
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      // For each track, create an ice gatherer, ice transport,
      // dtls transport, potentially rtpsender and rtpreceiver.
      var track = transceiver.track;
      var kind = transceiver.kind;
      var mid = transceiver.mid || SDPUtils.generateIdentifier();
      transceiver.mid = mid;

      if (!transceiver.iceGatherer) {
        transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
            pc.usingBundle);
      }

      var localCapabilities = window.RTCRtpSender.getCapabilities(kind);
      // filter RTX until additional stuff needed for RTX is implemented
      // in adapter.js
      if (edgeVersion < 15019) {
        localCapabilities.codecs = localCapabilities.codecs.filter(
            function(codec) {
              return codec.name !== 'rtx';
            });
      }
      localCapabilities.codecs.forEach(function(codec) {
        // work around https://bugs.chromium.org/p/webrtc/issues/detail?id=6552
        // by adding level-asymmetry-allowed=1
        if (codec.name === 'H264' &&
            codec.parameters['level-asymmetry-allowed'] === undefined) {
          codec.parameters['level-asymmetry-allowed'] = '1';
        }

        // for subsequent offers, we might have to re-use the payload
        // type of the last offer.
        if (transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.codecs) {
          transceiver.remoteCapabilities.codecs.forEach(function(remoteCodec) {
            if (codec.name.toLowerCase() === remoteCodec.name.toLowerCase() &&
                codec.clockRate === remoteCodec.clockRate) {
              codec.preferredPayloadType = remoteCodec.payloadType;
            }
          });
        }
      });
      localCapabilities.headerExtensions.forEach(function(hdrExt) {
        var remoteExtensions = transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.headerExtensions || [];
        remoteExtensions.forEach(function(rHdrExt) {
          if (hdrExt.uri === rHdrExt.uri) {
            hdrExt.id = rHdrExt.id;
          }
        });
      });

      // generate an ssrc now, to be used later in rtpSender.send
      var sendEncodingParameters = transceiver.sendEncodingParameters || [{
        ssrc: (2 * sdpMLineIndex + 1) * 1001
      }];
      if (track) {
        // add RTX
        if (edgeVersion >= 15019 && kind === 'video' &&
            !sendEncodingParameters[0].rtx) {
          sendEncodingParameters[0].rtx = {
            ssrc: sendEncodingParameters[0].ssrc + 1
          };
        }
      }

      if (transceiver.wantReceive) {
        transceiver.rtpReceiver = new window.RTCRtpReceiver(
            transceiver.dtlsTransport, kind);
      }

      transceiver.localCapabilities = localCapabilities;
      transceiver.sendEncodingParameters = sendEncodingParameters;
    });

    // always offer BUNDLE and dispose on return if not supported.
    if (pc._config.bundlePolicy !== 'max-compat') {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    sdp += 'a=ice-options:trickle\r\n';

    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      sdp += writeMediaSection(transceiver, transceiver.localCapabilities,
          'offer', transceiver.stream, pc._dtlsRole);
      sdp += 'a=rtcp-rsize\r\n';

      if (transceiver.iceGatherer && pc.iceGatheringState !== 'new' &&
          (sdpMLineIndex === 0 || !pc.usingBundle)) {
        transceiver.iceGatherer.getLocalCandidates().forEach(function(cand) {
          cand.component = 1;
          sdp += 'a=' + SDPUtils.writeCandidate(cand) + '\r\n';
        });

        if (transceiver.iceGatherer.state === 'completed') {
          sdp += 'a=end-of-candidates\r\n';
        }
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'offer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.createAnswer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer after close'));
    }

    if (!(pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer')) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer in signalingState ' + pc.signalingState));
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    if (pc.usingBundle) {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    var mediaSectionsInOffer = SDPUtils.getMediaSections(
        pc._remoteDescription.sdp).length;
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      if (sdpMLineIndex + 1 > mediaSectionsInOffer) {
        return;
      }
      if (transceiver.rejected) {
        if (transceiver.kind === 'application') {
          sdp += 'm=application 0 DTLS/SCTP 5000\r\n';
        } else if (transceiver.kind === 'audio') {
          sdp += 'm=audio 0 UDP/TLS/RTP/SAVPF 0\r\n' +
              'a=rtpmap:0 PCMU/8000\r\n';
        } else if (transceiver.kind === 'video') {
          sdp += 'm=video 0 UDP/TLS/RTP/SAVPF 120\r\n' +
              'a=rtpmap:120 VP8/90000\r\n';
        }
        sdp += 'c=IN IP4 0.0.0.0\r\n' +
            'a=inactive\r\n' +
            'a=mid:' + transceiver.mid + '\r\n';
        return;
      }

      // FIXME: look at direction.
      if (transceiver.stream) {
        var localTrack;
        if (transceiver.kind === 'audio') {
          localTrack = transceiver.stream.getAudioTracks()[0];
        } else if (transceiver.kind === 'video') {
          localTrack = transceiver.stream.getVideoTracks()[0];
        }
        if (localTrack) {
          // add RTX
          if (edgeVersion >= 15019 && transceiver.kind === 'video' &&
              !transceiver.sendEncodingParameters[0].rtx) {
            transceiver.sendEncodingParameters[0].rtx = {
              ssrc: transceiver.sendEncodingParameters[0].ssrc + 1
            };
          }
        }
      }

      // Calculate intersection of capabilities.
      var commonCapabilities = getCommonCapabilities(
          transceiver.localCapabilities,
          transceiver.remoteCapabilities);

      var hasRtx = commonCapabilities.codecs.filter(function(c) {
        return c.name.toLowerCase() === 'rtx';
      }).length;
      if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
        delete transceiver.sendEncodingParameters[0].rtx;
      }

      sdp += writeMediaSection(transceiver, commonCapabilities,
          'answer', transceiver.stream, pc._dtlsRole);
      if (transceiver.rtcpParameters &&
          transceiver.rtcpParameters.reducedSize) {
        sdp += 'a=rtcp-rsize\r\n';
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'answer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
    var pc = this;
    var sections;
    if (candidate && !(candidate.sdpMLineIndex !== undefined ||
        candidate.sdpMid)) {
      return Promise.reject(new TypeError('sdpMLineIndex or sdpMid required'));
    }

    // TODO: needs to go into ops queue.
    return new Promise(function(resolve, reject) {
      if (!pc._remoteDescription) {
        return reject(makeError('InvalidStateError',
            'Can not add ICE candidate without a remote description'));
      } else if (!candidate || candidate.candidate === '') {
        for (var j = 0; j < pc.transceivers.length; j++) {
          if (pc.transceivers[j].rejected) {
            continue;
          }
          pc.transceivers[j].iceTransport.addRemoteCandidate({});
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[j] += 'a=end-of-candidates\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
          if (pc.usingBundle) {
            break;
          }
        }
      } else {
        var sdpMLineIndex = candidate.sdpMLineIndex;
        if (candidate.sdpMid) {
          for (var i = 0; i < pc.transceivers.length; i++) {
            if (pc.transceivers[i].mid === candidate.sdpMid) {
              sdpMLineIndex = i;
              break;
            }
          }
        }
        var transceiver = pc.transceivers[sdpMLineIndex];
        if (transceiver) {
          if (transceiver.rejected) {
            return resolve();
          }
          var cand = Object.keys(candidate.candidate).length > 0 ?
              SDPUtils.parseCandidate(candidate.candidate) : {};
          // Ignore Chrome's invalid candidates since Edge does not like them.
          if (cand.protocol === 'tcp' && (cand.port === 0 || cand.port === 9)) {
            return resolve();
          }
          // Ignore RTCP candidates, we assume RTCP-MUX.
          if (cand.component && cand.component !== 1) {
            return resolve();
          }
          // when using bundle, avoid adding candidates to the wrong
          // ice transport. And avoid adding candidates added in the SDP.
          if (sdpMLineIndex === 0 || (sdpMLineIndex > 0 &&
              transceiver.iceTransport !== pc.transceivers[0].iceTransport)) {
            if (!maybeAddCandidate(transceiver.iceTransport, cand)) {
              return reject(makeError('OperationError',
                  'Can not add ICE candidate'));
            }
          }

          // update the remoteDescription.
          var candidateString = candidate.candidate.trim();
          if (candidateString.indexOf('a=') === 0) {
            candidateString = candidateString.substr(2);
          }
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[sdpMLineIndex] += 'a=' +
              (cand.type ? candidateString : 'end-of-candidates')
              + '\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
        } else {
          return reject(makeError('OperationError',
              'Can not add ICE candidate'));
        }
      }
      resolve();
    });
  };

  RTCPeerConnection.prototype.getStats = function(selector) {
    if (selector && selector instanceof window.MediaStreamTrack) {
      var senderOrReceiver = null;
      this.transceivers.forEach(function(transceiver) {
        if (transceiver.rtpSender &&
            transceiver.rtpSender.track === selector) {
          senderOrReceiver = transceiver.rtpSender;
        } else if (transceiver.rtpReceiver &&
            transceiver.rtpReceiver.track === selector) {
          senderOrReceiver = transceiver.rtpReceiver;
        }
      });
      if (!senderOrReceiver) {
        throw makeError('InvalidAccessError', 'Invalid selector.');
      }
      return senderOrReceiver.getStats();
    }

    var promises = [];
    this.transceivers.forEach(function(transceiver) {
      ['rtpSender', 'rtpReceiver', 'iceGatherer', 'iceTransport',
          'dtlsTransport'].forEach(function(method) {
            if (transceiver[method]) {
              promises.push(transceiver[method].getStats());
            }
          });
    });
    return Promise.all(promises).then(function(allStats) {
      var results = new Map();
      allStats.forEach(function(stats) {
        stats.forEach(function(stat) {
          results.set(stat.id, stat);
        });
      });
      return results;
    });
  };

  // fix low-level stat names and return Map instead of object.
  var ortcObjects = ['RTCRtpSender', 'RTCRtpReceiver', 'RTCIceGatherer',
    'RTCIceTransport', 'RTCDtlsTransport'];
  ortcObjects.forEach(function(ortcObjectName) {
    var obj = window[ortcObjectName];
    if (obj && obj.prototype && obj.prototype.getStats) {
      var nativeGetstats = obj.prototype.getStats;
      obj.prototype.getStats = function() {
        return nativeGetstats.apply(this)
        .then(function(nativeStats) {
          var mapStats = new Map();
          Object.keys(nativeStats).forEach(function(id) {
            nativeStats[id].type = fixStatsType(nativeStats[id]);
            mapStats.set(id, nativeStats[id]);
          });
          return mapStats;
        });
      };
    }
  });

  // legacy callback shims. Should be moved to adapter.js some days.
  var methods = ['createOffer', 'createAnswer'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[0] === 'function' ||
          typeof args[1] === 'function') { // legacy
        return nativeMethod.apply(this, [arguments[2]])
        .then(function(description) {
          if (typeof args[0] === 'function') {
            args[0].apply(null, [description]);
          }
        }, function(error) {
          if (typeof args[1] === 'function') {
            args[1].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  methods = ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function' ||
          typeof args[2] === 'function') { // legacy
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        }, function(error) {
          if (typeof args[2] === 'function') {
            args[2].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  // getStats is special. It doesn't have a spec legacy method yet we support
  // getStats(something, cb) without error callbacks.
  ['getStats'].forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function') {
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  return RTCPeerConnection;
};

},{"sdp":2}],2:[function(require,module,exports){
 /* eslint-env node */
'use strict';

// SDP helpers.
var SDPUtils = {};

// Generate an alphanumeric identifier for cname or mids.
// TODO: use UUIDs instead? https://gist.github.com/jed/982883
SDPUtils.generateIdentifier = function() {
  return Math.random().toString(36).substr(2, 10);
};

// The RTCP CNAME used by all peerconnections from the same JS.
SDPUtils.localCName = SDPUtils.generateIdentifier();

// Splits SDP into lines, dealing with both CRLF and LF.
SDPUtils.splitLines = function(blob) {
  return blob.trim().split('\n').map(function(line) {
    return line.trim();
  });
};
// Splits SDP into sessionpart and mediasections. Ensures CRLF.
SDPUtils.splitSections = function(blob) {
  var parts = blob.split('\nm=');
  return parts.map(function(part, index) {
    return (index > 0 ? 'm=' + part : part).trim() + '\r\n';
  });
};

// returns the session description.
SDPUtils.getDescription = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  return sections && sections[0];
};

// returns the individual media sections.
SDPUtils.getMediaSections = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  sections.shift();
  return sections;
};

// Returns lines that start with a certain prefix.
SDPUtils.matchPrefix = function(blob, prefix) {
  return SDPUtils.splitLines(blob).filter(function(line) {
    return line.indexOf(prefix) === 0;
  });
};

// Parses an ICE candidate line. Sample input:
// candidate:702786350 2 udp 41819902 8.8.8.8 60769 typ relay raddr 8.8.8.8
// rport 55996"
SDPUtils.parseCandidate = function(line) {
  var parts;
  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  var candidate = {
    foundation: parts[0],
    component: parseInt(parts[1], 10),
    protocol: parts[2].toLowerCase(),
    priority: parseInt(parts[3], 10),
    ip: parts[4],
    port: parseInt(parts[5], 10),
    // skip parts[6] == 'typ'
    type: parts[7]
  };

  for (var i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        candidate.relatedAddress = parts[i + 1];
        break;
      case 'rport':
        candidate.relatedPort = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        candidate.tcpType = parts[i + 1];
        break;
      case 'ufrag':
        candidate.ufrag = parts[i + 1]; // for backward compability.
        candidate.usernameFragment = parts[i + 1];
        break;
      default: // extension handling, in particular ufrag
        candidate[parts[i]] = parts[i + 1];
        break;
    }
  }
  return candidate;
};

// Translates a candidate object into SDP candidate attribute.
SDPUtils.writeCandidate = function(candidate) {
  var sdp = [];
  sdp.push(candidate.foundation);
  sdp.push(candidate.component);
  sdp.push(candidate.protocol.toUpperCase());
  sdp.push(candidate.priority);
  sdp.push(candidate.ip);
  sdp.push(candidate.port);

  var type = candidate.type;
  sdp.push('typ');
  sdp.push(type);
  if (type !== 'host' && candidate.relatedAddress &&
      candidate.relatedPort) {
    sdp.push('raddr');
    sdp.push(candidate.relatedAddress);
    sdp.push('rport');
    sdp.push(candidate.relatedPort);
  }
  if (candidate.tcpType && candidate.protocol.toLowerCase() === 'tcp') {
    sdp.push('tcptype');
    sdp.push(candidate.tcpType);
  }
  if (candidate.usernameFragment || candidate.ufrag) {
    sdp.push('ufrag');
    sdp.push(candidate.usernameFragment || candidate.ufrag);
  }
  return 'candidate:' + sdp.join(' ');
};

// Parses an ice-options line, returns an array of option tags.
// a=ice-options:foo bar
SDPUtils.parseIceOptions = function(line) {
  return line.substr(14).split(' ');
}

// Parses an rtpmap line, returns RTCRtpCoddecParameters. Sample input:
// a=rtpmap:111 opus/48000/2
SDPUtils.parseRtpMap = function(line) {
  var parts = line.substr(9).split(' ');
  var parsed = {
    payloadType: parseInt(parts.shift(), 10) // was: id
  };

  parts = parts[0].split('/');

  parsed.name = parts[0];
  parsed.clockRate = parseInt(parts[1], 10); // was: clockrate
  parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
  // legacy alias, got renamed back to channels in ORTC.
  parsed.numChannels = parsed.channels;
  return parsed;
};

// Generate an a=rtpmap line from RTCRtpCodecCapability or
// RTCRtpCodecParameters.
SDPUtils.writeRtpMap = function(codec) {
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  var channels = codec.channels || codec.numChannels || 1;
  return 'a=rtpmap:' + pt + ' ' + codec.name + '/' + codec.clockRate +
      (channels !== 1 ? '/' + channels : '') + '\r\n';
};

// Parses an a=extmap line (headerextension from RFC 5285). Sample input:
// a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
// a=extmap:2/sendonly urn:ietf:params:rtp-hdrext:toffset
SDPUtils.parseExtmap = function(line) {
  var parts = line.substr(9).split(' ');
  return {
    id: parseInt(parts[0], 10),
    direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
    uri: parts[1]
  };
};

// Generates a=extmap line from RTCRtpHeaderExtensionParameters or
// RTCRtpHeaderExtension.
SDPUtils.writeExtmap = function(headerExtension) {
  return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
      (headerExtension.direction && headerExtension.direction !== 'sendrecv'
          ? '/' + headerExtension.direction
          : '') +
      ' ' + headerExtension.uri + '\r\n';
};

// Parses an ftmp line, returns dictionary. Sample input:
// a=fmtp:96 vbr=on;cng=on
// Also deals with vbr=on; cng=on
SDPUtils.parseFmtp = function(line) {
  var parsed = {};
  var kv;
  var parts = line.substr(line.indexOf(' ') + 1).split(';');
  for (var j = 0; j < parts.length; j++) {
    kv = parts[j].trim().split('=');
    parsed[kv[0].trim()] = kv[1];
  }
  return parsed;
};

// Generates an a=ftmp line from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeFmtp = function(codec) {
  var line = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.parameters && Object.keys(codec.parameters).length) {
    var params = [];
    Object.keys(codec.parameters).forEach(function(param) {
      if (codec.parameters[param]) {
        params.push(param + '=' + codec.parameters[param]);
      } else {
        params.push(param);
      }
    });
    line += 'a=fmtp:' + pt + ' ' + params.join(';') + '\r\n';
  }
  return line;
};

// Parses an rtcp-fb line, returns RTCPRtcpFeedback object. Sample input:
// a=rtcp-fb:98 nack rpsi
SDPUtils.parseRtcpFb = function(line) {
  var parts = line.substr(line.indexOf(' ') + 1).split(' ');
  return {
    type: parts.shift(),
    parameter: parts.join(' ')
  };
};
// Generate a=rtcp-fb lines from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeRtcpFb = function(codec) {
  var lines = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
    // FIXME: special handling for trr-int?
    codec.rtcpFeedback.forEach(function(fb) {
      lines += 'a=rtcp-fb:' + pt + ' ' + fb.type +
      (fb.parameter && fb.parameter.length ? ' ' + fb.parameter : '') +
          '\r\n';
    });
  }
  return lines;
};

// Parses an RFC 5576 ssrc media attribute. Sample input:
// a=ssrc:3735928559 cname:something
SDPUtils.parseSsrcMedia = function(line) {
  var sp = line.indexOf(' ');
  var parts = {
    ssrc: parseInt(line.substr(7, sp - 7), 10)
  };
  var colon = line.indexOf(':', sp);
  if (colon > -1) {
    parts.attribute = line.substr(sp + 1, colon - sp - 1);
    parts.value = line.substr(colon + 1);
  } else {
    parts.attribute = line.substr(sp + 1);
  }
  return parts;
};

// Extracts the MID (RFC 5888) from a media section.
// returns the MID or undefined if no mid line was found.
SDPUtils.getMid = function(mediaSection) {
  var mid = SDPUtils.matchPrefix(mediaSection, 'a=mid:')[0];
  if (mid) {
    return mid.substr(6);
  }
}

SDPUtils.parseFingerprint = function(line) {
  var parts = line.substr(14).split(' ');
  return {
    algorithm: parts[0].toLowerCase(), // algorithm is case-sensitive in Edge.
    value: parts[1]
  };
};

// Extracts DTLS parameters from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the fingerprint line as input. See also getIceParameters.
SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
      'a=fingerprint:');
  // Note: a=setup line is ignored since we use the 'auto' role.
  // Note2: 'algorithm' is not case sensitive except in Edge.
  return {
    role: 'auto',
    fingerprints: lines.map(SDPUtils.parseFingerprint)
  };
};

// Serializes DTLS parameters to SDP.
SDPUtils.writeDtlsParameters = function(params, setupType) {
  var sdp = 'a=setup:' + setupType + '\r\n';
  params.fingerprints.forEach(function(fp) {
    sdp += 'a=fingerprint:' + fp.algorithm + ' ' + fp.value + '\r\n';
  });
  return sdp;
};
// Parses ICE information from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the ice-ufrag and ice-pwd lines as input.
SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.splitLines(mediaSection);
  // Search in session part, too.
  lines = lines.concat(SDPUtils.splitLines(sessionpart));
  var iceParameters = {
    usernameFragment: lines.filter(function(line) {
      return line.indexOf('a=ice-ufrag:') === 0;
    })[0].substr(12),
    password: lines.filter(function(line) {
      return line.indexOf('a=ice-pwd:') === 0;
    })[0].substr(10)
  };
  return iceParameters;
};

// Serializes ICE parameters to SDP.
SDPUtils.writeIceParameters = function(params) {
  return 'a=ice-ufrag:' + params.usernameFragment + '\r\n' +
      'a=ice-pwd:' + params.password + '\r\n';
};

// Parses the SDP media section and returns RTCRtpParameters.
SDPUtils.parseRtpParameters = function(mediaSection) {
  var description = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: [],
    rtcp: []
  };
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  for (var i = 3; i < mline.length; i++) { // find all codecs from mline[3..]
    var pt = mline[i];
    var rtpmapline = SDPUtils.matchPrefix(
        mediaSection, 'a=rtpmap:' + pt + ' ')[0];
    if (rtpmapline) {
      var codec = SDPUtils.parseRtpMap(rtpmapline);
      var fmtps = SDPUtils.matchPrefix(
          mediaSection, 'a=fmtp:' + pt + ' ');
      // Only the first a=fmtp:<pt> is considered.
      codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
      codec.rtcpFeedback = SDPUtils.matchPrefix(
          mediaSection, 'a=rtcp-fb:' + pt + ' ')
        .map(SDPUtils.parseRtcpFb);
      description.codecs.push(codec);
      // parse FEC mechanisms from rtpmap lines.
      switch (codec.name.toUpperCase()) {
        case 'RED':
        case 'ULPFEC':
          description.fecMechanisms.push(codec.name.toUpperCase());
          break;
        default: // only RED and ULPFEC are recognized as FEC mechanisms.
          break;
      }
    }
  }
  SDPUtils.matchPrefix(mediaSection, 'a=extmap:').forEach(function(line) {
    description.headerExtensions.push(SDPUtils.parseExtmap(line));
  });
  // FIXME: parse rtcp.
  return description;
};

// Generates parts of the SDP media section describing the capabilities /
// parameters.
SDPUtils.writeRtpDescription = function(kind, caps) {
  var sdp = '';

  // Build the mline.
  sdp += 'm=' + kind + ' ';
  sdp += caps.codecs.length > 0 ? '9' : '0'; // reject if no codecs.
  sdp += ' UDP/TLS/RTP/SAVPF ';
  sdp += caps.codecs.map(function(codec) {
    if (codec.preferredPayloadType !== undefined) {
      return codec.preferredPayloadType;
    }
    return codec.payloadType;
  }).join(' ') + '\r\n';

  sdp += 'c=IN IP4 0.0.0.0\r\n';
  sdp += 'a=rtcp:9 IN IP4 0.0.0.0\r\n';

  // Add a=rtpmap lines for each codec. Also fmtp and rtcp-fb.
  caps.codecs.forEach(function(codec) {
    sdp += SDPUtils.writeRtpMap(codec);
    sdp += SDPUtils.writeFmtp(codec);
    sdp += SDPUtils.writeRtcpFb(codec);
  });
  var maxptime = 0;
  caps.codecs.forEach(function(codec) {
    if (codec.maxptime > maxptime) {
      maxptime = codec.maxptime;
    }
  });
  if (maxptime > 0) {
    sdp += 'a=maxptime:' + maxptime + '\r\n';
  }
  sdp += 'a=rtcp-mux\r\n';

  if (caps.headerExtensions) {
    caps.headerExtensions.forEach(function(extension) {
      sdp += SDPUtils.writeExtmap(extension);
    });
  }
  // FIXME: write fecMechanisms.
  return sdp;
};

// Parses the SDP media section and returns an array of
// RTCRtpEncodingParameters.
SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
  var encodingParameters = [];
  var description = SDPUtils.parseRtpParameters(mediaSection);
  var hasRed = description.fecMechanisms.indexOf('RED') !== -1;
  var hasUlpfec = description.fecMechanisms.indexOf('ULPFEC') !== -1;

  // filter a=ssrc:... cname:, ignore PlanB-msid
  var ssrcs = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'cname';
  });
  var primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
  var secondarySsrc;

  var flows = SDPUtils.matchPrefix(mediaSection, 'a=ssrc-group:FID')
  .map(function(line) {
    var parts = line.substr(17).split(' ');
    return parts.map(function(part) {
      return parseInt(part, 10);
    });
  });
  if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
    secondarySsrc = flows[0][1];
  }

  description.codecs.forEach(function(codec) {
    if (codec.name.toUpperCase() === 'RTX' && codec.parameters.apt) {
      var encParam = {
        ssrc: primarySsrc,
        codecPayloadType: parseInt(codec.parameters.apt, 10),
      };
      if (primarySsrc && secondarySsrc) {
        encParam.rtx = {ssrc: secondarySsrc};
      }
      encodingParameters.push(encParam);
      if (hasRed) {
        encParam = JSON.parse(JSON.stringify(encParam));
        encParam.fec = {
          ssrc: secondarySsrc,
          mechanism: hasUlpfec ? 'red+ulpfec' : 'red'
        };
        encodingParameters.push(encParam);
      }
    }
  });
  if (encodingParameters.length === 0 && primarySsrc) {
    encodingParameters.push({
      ssrc: primarySsrc
    });
  }

  // we support both b=AS and b=TIAS but interpret AS as TIAS.
  var bandwidth = SDPUtils.matchPrefix(mediaSection, 'b=');
  if (bandwidth.length) {
    if (bandwidth[0].indexOf('b=TIAS:') === 0) {
      bandwidth = parseInt(bandwidth[0].substr(7), 10);
    } else if (bandwidth[0].indexOf('b=AS:') === 0) {
      // use formula from JSEP to convert b=AS to TIAS value.
      bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95
          - (50 * 40 * 8);
    } else {
      bandwidth = undefined;
    }
    encodingParameters.forEach(function(params) {
      params.maxBitrate = bandwidth;
    });
  }
  return encodingParameters;
};

// parses http://draft.ortc.org/#rtcrtcpparameters*
SDPUtils.parseRtcpParameters = function(mediaSection) {
  var rtcpParameters = {};

  var cname;
  // Gets the first SSRC. Note that with RTX there might be multiple
  // SSRCs.
  var remoteSsrc = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
      .map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
      })
      .filter(function(obj) {
        return obj.attribute === 'cname';
      })[0];
  if (remoteSsrc) {
    rtcpParameters.cname = remoteSsrc.value;
    rtcpParameters.ssrc = remoteSsrc.ssrc;
  }

  // Edge uses the compound attribute instead of reducedSize
  // compound is !reducedSize
  var rsize = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-rsize');
  rtcpParameters.reducedSize = rsize.length > 0;
  rtcpParameters.compound = rsize.length === 0;

  // parses the rtcp-mux attrіbute.
  // Note that Edge does not support unmuxed RTCP.
  var mux = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux');
  rtcpParameters.mux = mux.length > 0;

  return rtcpParameters;
};

// parses either a=msid: or a=ssrc:... msid lines and returns
// the id of the MediaStream and MediaStreamTrack.
SDPUtils.parseMsid = function(mediaSection) {
  var parts;
  var spec = SDPUtils.matchPrefix(mediaSection, 'a=msid:');
  if (spec.length === 1) {
    parts = spec[0].substr(7).split(' ');
    return {stream: parts[0], track: parts[1]};
  }
  var planB = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'msid';
  });
  if (planB.length > 0) {
    parts = planB[0].value.split(' ');
    return {stream: parts[0], track: parts[1]};
  }
};

// Generate a session ID for SDP.
// https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-20#section-5.2.1
// recommends using a cryptographically random +ve 64-bit value
// but right now this should be acceptable and within the right range
SDPUtils.generateSessionId = function() {
  return Math.random().toString().substr(2, 21);
};

// Write boilder plate for start of SDP
// sessId argument is optional - if not supplied it will
// be generated randomly
// sessVersion is optional and defaults to 2
SDPUtils.writeSessionBoilerplate = function(sessId, sessVer) {
  var sessionId;
  var version = sessVer !== undefined ? sessVer : 2;
  if (sessId) {
    sessionId = sessId;
  } else {
    sessionId = SDPUtils.generateSessionId();
  }
  // FIXME: sess-id should be an NTP timestamp.
  return 'v=0\r\n' +
      'o=thisisadapterortc ' + sessionId + ' ' + version + ' IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n';
};

SDPUtils.writeMediaSection = function(transceiver, caps, type, stream) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.direction) {
    sdp += 'a=' + transceiver.direction + '\r\n';
  } else if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    // spec.
    var msid = 'msid:' + stream.id + ' ' +
        transceiver.rtpSender.track.id + '\r\n';
    sdp += 'a=' + msid;

    // for Chrome.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
};

// Gets the direction from the mediaSection or the sessionpart.
SDPUtils.getDirection = function(mediaSection, sessionpart) {
  // Look for sendrecv, sendonly, recvonly, inactive, default to sendrecv.
  var lines = SDPUtils.splitLines(mediaSection);
  for (var i = 0; i < lines.length; i++) {
    switch (lines[i]) {
      case 'a=sendrecv':
      case 'a=sendonly':
      case 'a=recvonly':
      case 'a=inactive':
        return lines[i].substr(2);
      default:
        // FIXME: What should happen here?
    }
  }
  if (sessionpart) {
    return SDPUtils.getDirection(sessionpart);
  }
  return 'sendrecv';
};

SDPUtils.getKind = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  return mline[0].substr(2);
};

SDPUtils.isRejected = function(mediaSection) {
  return mediaSection.split(' ', 2)[1] === '0';
};

SDPUtils.parseMLine = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var parts = lines[0].substr(2).split(' ');
  return {
    kind: parts[0],
    port: parseInt(parts[1], 10),
    protocol: parts[2],
    fmt: parts.slice(3).join(' ')
  };
};

SDPUtils.parseOLine = function(mediaSection) {
  var line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
  var parts = line.substr(2).split(' ');
  return {
    username: parts[0],
    sessionId: parts[1],
    sessionVersion: parseInt(parts[2], 10),
    netType: parts[3],
    addressType: parts[4],
    address: parts[5],
  };
}

// Expose public methods.
if (typeof module === 'object') {
  module.exports = SDPUtils;
}

},{}],3:[function(require,module,exports){
(function (global){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */

'use strict';

var adapterFactory = require('./adapter_factory.js');
module.exports = adapterFactory({window: global.window});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./adapter_factory.js":4}],4:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */

'use strict';

var utils = require('./utils');
// Shimming starts here.
module.exports = function(dependencies, opts) {
  var window = dependencies && dependencies.window;

  var options = {
    shimChrome: true,
    shimFirefox: true,
    shimEdge: true,
    shimSafari: true,
  };

  for (var key in opts) {
    if (hasOwnProperty.call(opts, key)) {
      options[key] = opts[key];
    }
  }

  // Utils.
  var logging = utils.log;
  var browserDetails = utils.detectBrowser(window);

  // Uncomment the line below if you want logging to occur, including logging
  // for the switch statement below. Can also be turned on in the browser via
  // adapter.disableLog(false), but then logging from the switch statement below
  // will not appear.
  // require('./utils').disableLog(false);

  // Browser shims.
  var chromeShim = require('./chrome/chrome_shim') || null;
  var edgeShim = require('./edge/edge_shim') || null;
  var firefoxShim = require('./firefox/firefox_shim') || null;
  var safariShim = require('./safari/safari_shim') || null;
  var commonShim = require('./common_shim') || null;

  // Export to the adapter global object visible in the browser.
  var adapter = {
    browserDetails: browserDetails,
    commonShim: commonShim,
    extractVersion: utils.extractVersion,
    disableLog: utils.disableLog,
    disableWarnings: utils.disableWarnings
  };

  // Shim browser if found.
  switch (browserDetails.browser) {
    case 'chrome':
      if (!chromeShim || !chromeShim.shimPeerConnection ||
          !options.shimChrome) {
        logging('Chrome shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming chrome.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = chromeShim;
      commonShim.shimCreateObjectURL(window);

      chromeShim.shimGetUserMedia(window);
      chromeShim.shimMediaStream(window);
      chromeShim.shimSourceObject(window);
      chromeShim.shimPeerConnection(window);
      chromeShim.shimOnTrack(window);
      chromeShim.shimAddTrackRemoveTrack(window);
      chromeShim.shimGetSendersWithDtmf(window);
      chromeShim.shimSenderReceiverGetStats(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'firefox':
      if (!firefoxShim || !firefoxShim.shimPeerConnection ||
          !options.shimFirefox) {
        logging('Firefox shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming firefox.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = firefoxShim;
      commonShim.shimCreateObjectURL(window);

      firefoxShim.shimGetUserMedia(window);
      firefoxShim.shimSourceObject(window);
      firefoxShim.shimPeerConnection(window);
      firefoxShim.shimOnTrack(window);
      firefoxShim.shimRemoveStream(window);
      firefoxShim.shimSenderGetStats(window);
      firefoxShim.shimReceiverGetStats(window);
      firefoxShim.shimRTCDataChannel(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'edge':
      if (!edgeShim || !edgeShim.shimPeerConnection || !options.shimEdge) {
        logging('MS edge shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming edge.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = edgeShim;
      commonShim.shimCreateObjectURL(window);

      edgeShim.shimGetUserMedia(window);
      edgeShim.shimPeerConnection(window);
      edgeShim.shimReplaceTrack(window);

      // the edge shim implements the full RTCIceCandidate object.

      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'safari':
      if (!safariShim || !options.shimSafari) {
        logging('Safari shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming safari.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = safariShim;
      commonShim.shimCreateObjectURL(window);

      safariShim.shimRTCIceServerUrls(window);
      safariShim.shimCallbacksAPI(window);
      safariShim.shimLocalStreamsAPI(window);
      safariShim.shimRemoteStreamsAPI(window);
      safariShim.shimTrackEventTransceiver(window);
      safariShim.shimGetUserMedia(window);
      safariShim.shimCreateOfferLegacy(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    default:
      logging('Unsupported browser!');
      break;
  }

  return adapter;
};

},{"./chrome/chrome_shim":5,"./common_shim":7,"./edge/edge_shim":8,"./firefox/firefox_shim":11,"./safari/safari_shim":13,"./utils":14}],5:[function(require,module,exports){

/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';
var utils = require('../utils.js');
var logging = utils.log;

/* iterates the stats graph recursively. */
function walkStats(stats, base, resultSet) {
  if (!base || resultSet.has(base.id)) {
    return;
  }
  resultSet.set(base.id, base);
  Object.keys(base).forEach(function(name) {
    if (name.endsWith('Id')) {
      walkStats(stats, stats.get(base[name]), resultSet);
    } else if (name.endsWith('Ids')) {
      base[name].forEach(function(id) {
        walkStats(stats, stats.get(id), resultSet);
      });
    }
  });
}

/* filter getStats for a sender/receiver track. */
function filterStats(result, track, outbound) {
  var streamStatsType = outbound ? 'outbound-rtp' : 'inbound-rtp';
  var filteredResult = new Map();
  if (track === null) {
    return filteredResult;
  }
  var trackStats = [];
  result.forEach(function(value) {
    if (value.type === 'track' &&
        value.trackIdentifier === track.id) {
      trackStats.push(value);
    }
  });
  trackStats.forEach(function(trackStat) {
    result.forEach(function(stats) {
      if (stats.type === streamStatsType && stats.trackId === trackStat.id) {
        walkStats(result, stats, filteredResult);
      }
    });
  });
  return filteredResult;
}

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimMediaStream: function(window) {
    window.MediaStream = window.MediaStream || window.webkitMediaStream;
  },

  shimOnTrack: function(window) {
    if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
        window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
        get: function() {
          return this._ontrack;
        },
        set: function(f) {
          if (this._ontrack) {
            this.removeEventListener('track', this._ontrack);
          }
          this.addEventListener('track', this._ontrack = f);
        }
      });
      var origSetRemoteDescription =
          window.RTCPeerConnection.prototype.setRemoteDescription;
      window.RTCPeerConnection.prototype.setRemoteDescription = function() {
        var pc = this;
        if (!pc._ontrackpoly) {
          pc._ontrackpoly = function(e) {
            // onaddstream does not fire when a track is added to an existing
            // stream. But stream.onaddtrack is implemented so we use that.
            e.stream.addEventListener('addtrack', function(te) {
              var receiver;
              if (window.RTCPeerConnection.prototype.getReceivers) {
                receiver = pc.getReceivers().find(function(r) {
                  return r.track && r.track.id === te.track.id;
                });
              } else {
                receiver = {track: te.track};
              }

              var event = new Event('track');
              event.track = te.track;
              event.receiver = receiver;
              event.transceiver = {receiver: receiver};
              event.streams = [e.stream];
              pc.dispatchEvent(event);
            });
            e.stream.getTracks().forEach(function(track) {
              var receiver;
              if (window.RTCPeerConnection.prototype.getReceivers) {
                receiver = pc.getReceivers().find(function(r) {
                  return r.track && r.track.id === track.id;
                });
              } else {
                receiver = {track: track};
              }
              var event = new Event('track');
              event.track = track;
              event.receiver = receiver;
              event.transceiver = {receiver: receiver};
              event.streams = [e.stream];
              pc.dispatchEvent(event);
            });
          };
          pc.addEventListener('addstream', pc._ontrackpoly);
        }
        return origSetRemoteDescription.apply(pc, arguments);
      };
    } else if (!('RTCRtpTransceiver' in window)) {
      utils.wrapPeerConnectionEvent(window, 'track', function(e) {
        if (!e.transceiver) {
          e.transceiver = {receiver: e.receiver};
        }
        return e;
      });
    }
  },

  shimGetSendersWithDtmf: function(window) {
    // Overrides addTrack/removeTrack, depends on shimAddTrackRemoveTrack.
    if (typeof window === 'object' && window.RTCPeerConnection &&
        !('getSenders' in window.RTCPeerConnection.prototype) &&
        'createDTMFSender' in window.RTCPeerConnection.prototype) {
      var shimSenderWithDtmf = function(pc, track) {
        return {
          track: track,
          get dtmf() {
            if (this._dtmf === undefined) {
              if (track.kind === 'audio') {
                this._dtmf = pc.createDTMFSender(track);
              } else {
                this._dtmf = null;
              }
            }
            return this._dtmf;
          },
          _pc: pc
        };
      };

      // augment addTrack when getSenders is not available.
      if (!window.RTCPeerConnection.prototype.getSenders) {
        window.RTCPeerConnection.prototype.getSenders = function() {
          this._senders = this._senders || [];
          return this._senders.slice(); // return a copy of the internal state.
        };
        var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
        window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
          var pc = this;
          var sender = origAddTrack.apply(pc, arguments);
          if (!sender) {
            sender = shimSenderWithDtmf(pc, track);
            pc._senders.push(sender);
          }
          return sender;
        };

        var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
        window.RTCPeerConnection.prototype.removeTrack = function(sender) {
          var pc = this;
          origRemoveTrack.apply(pc, arguments);
          var idx = pc._senders.indexOf(sender);
          if (idx !== -1) {
            pc._senders.splice(idx, 1);
          }
        };
      }
      var origAddStream = window.RTCPeerConnection.prototype.addStream;
      window.RTCPeerConnection.prototype.addStream = function(stream) {
        var pc = this;
        pc._senders = pc._senders || [];
        origAddStream.apply(pc, [stream]);
        stream.getTracks().forEach(function(track) {
          pc._senders.push(shimSenderWithDtmf(pc, track));
        });
      };

      var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
      window.RTCPeerConnection.prototype.removeStream = function(stream) {
        var pc = this;
        pc._senders = pc._senders || [];
        origRemoveStream.apply(pc, [stream]);

        stream.getTracks().forEach(function(track) {
          var sender = pc._senders.find(function(s) {
            return s.track === track;
          });
          if (sender) {
            pc._senders.splice(pc._senders.indexOf(sender), 1); // remove sender
          }
        });
      };
    } else if (typeof window === 'object' && window.RTCPeerConnection &&
               'getSenders' in window.RTCPeerConnection.prototype &&
               'createDTMFSender' in window.RTCPeerConnection.prototype &&
               window.RTCRtpSender &&
               !('dtmf' in window.RTCRtpSender.prototype)) {
      var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
      window.RTCPeerConnection.prototype.getSenders = function() {
        var pc = this;
        var senders = origGetSenders.apply(pc, []);
        senders.forEach(function(sender) {
          sender._pc = pc;
        });
        return senders;
      };

      Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
        get: function() {
          if (this._dtmf === undefined) {
            if (this.track.kind === 'audio') {
              this._dtmf = this._pc.createDTMFSender(this.track);
            } else {
              this._dtmf = null;
            }
          }
          return this._dtmf;
        }
      });
    }
  },

  shimSenderReceiverGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender && window.RTCRtpReceiver)) {
      return;
    }

    // shim sender stats.
    if (!('getStats' in window.RTCRtpSender.prototype)) {
      var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
      if (origGetSenders) {
        window.RTCPeerConnection.prototype.getSenders = function() {
          var pc = this;
          var senders = origGetSenders.apply(pc, []);
          senders.forEach(function(sender) {
            sender._pc = pc;
          });
          return senders;
        };
      }

      var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
      if (origAddTrack) {
        window.RTCPeerConnection.prototype.addTrack = function() {
          var sender = origAddTrack.apply(this, arguments);
          sender._pc = this;
          return sender;
        };
      }
      window.RTCRtpSender.prototype.getStats = function() {
        var sender = this;
        return this._pc.getStats().then(function(result) {
          /* Note: this will include stats of all senders that
           *   send a track with the same id as sender.track as
           *   it is not possible to identify the RTCRtpSender.
           */
          return filterStats(result, sender.track, true);
        });
      };
    }

    // shim receiver stats.
    if (!('getStats' in window.RTCRtpReceiver.prototype)) {
      var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
      if (origGetReceivers) {
        window.RTCPeerConnection.prototype.getReceivers = function() {
          var pc = this;
          var receivers = origGetReceivers.apply(pc, []);
          receivers.forEach(function(receiver) {
            receiver._pc = pc;
          });
          return receivers;
        };
      }
      utils.wrapPeerConnectionEvent(window, 'track', function(e) {
        e.receiver._pc = e.srcElement;
        return e;
      });
      window.RTCRtpReceiver.prototype.getStats = function() {
        var receiver = this;
        return this._pc.getStats().then(function(result) {
          return filterStats(result, receiver.track, false);
        });
      };
    }

    if (!('getStats' in window.RTCRtpSender.prototype &&
        'getStats' in window.RTCRtpReceiver.prototype)) {
      return;
    }

    // shim RTCPeerConnection.getStats(track).
    var origGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function() {
      var pc = this;
      if (arguments.length > 0 &&
          arguments[0] instanceof window.MediaStreamTrack) {
        var track = arguments[0];
        var sender;
        var receiver;
        var err;
        pc.getSenders().forEach(function(s) {
          if (s.track === track) {
            if (sender) {
              err = true;
            } else {
              sender = s;
            }
          }
        });
        pc.getReceivers().forEach(function(r) {
          if (r.track === track) {
            if (receiver) {
              err = true;
            } else {
              receiver = r;
            }
          }
          return r.track === track;
        });
        if (err || (sender && receiver)) {
          return Promise.reject(new DOMException(
            'There are more than one sender or receiver for the track.',
            'InvalidAccessError'));
        } else if (sender) {
          return sender.getStats();
        } else if (receiver) {
          return receiver.getStats();
        }
        return Promise.reject(new DOMException(
          'There is no sender or receiver for the track.',
          'InvalidAccessError'));
      }
      return origGetStats.apply(pc, arguments);
    };
  },

  shimSourceObject: function(window) {
    var URL = window && window.URL;

    if (typeof window === 'object') {
      if (window.HTMLMediaElement &&
        !('srcObject' in window.HTMLMediaElement.prototype)) {
        // Shim the srcObject property, once, when HTMLMediaElement is found.
        Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
          get: function() {
            return this._srcObject;
          },
          set: function(stream) {
            var self = this;
            // Use _srcObject as a private property for this shim
            this._srcObject = stream;
            if (this.src) {
              URL.revokeObjectURL(this.src);
            }

            if (!stream) {
              this.src = '';
              return undefined;
            }
            this.src = URL.createObjectURL(stream);
            // We need to recreate the blob url when a track is added or
            // removed. Doing it manually since we want to avoid a recursion.
            stream.addEventListener('addtrack', function() {
              if (self.src) {
                URL.revokeObjectURL(self.src);
              }
              self.src = URL.createObjectURL(stream);
            });
            stream.addEventListener('removetrack', function() {
              if (self.src) {
                URL.revokeObjectURL(self.src);
              }
              self.src = URL.createObjectURL(stream);
            });
          }
        });
      }
    }
  },

  shimAddTrackRemoveTrackWithNative: function(window) {
    // shim addTrack/removeTrack with native variants in order to make
    // the interactions with legacy getLocalStreams behave as in other browsers.
    // Keeps a mapping stream.id => [stream, rtpsenders...]
    window.RTCPeerConnection.prototype.getLocalStreams = function() {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      return Object.keys(this._shimmedLocalStreams).map(function(streamId) {
        return pc._shimmedLocalStreams[streamId][0];
      });
    };

    var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
    window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
      if (!stream) {
        return origAddTrack.apply(this, arguments);
      }
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};

      var sender = origAddTrack.apply(this, arguments);
      if (!this._shimmedLocalStreams[stream.id]) {
        this._shimmedLocalStreams[stream.id] = [stream, sender];
      } else if (this._shimmedLocalStreams[stream.id].indexOf(sender) === -1) {
        this._shimmedLocalStreams[stream.id].push(sender);
      }
      return sender;
    };

    var origAddStream = window.RTCPeerConnection.prototype.addStream;
    window.RTCPeerConnection.prototype.addStream = function(stream) {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};

      stream.getTracks().forEach(function(track) {
        var alreadyExists = pc.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException('Track already exists.',
              'InvalidAccessError');
        }
      });
      var existingSenders = pc.getSenders();
      origAddStream.apply(this, arguments);
      var newSenders = pc.getSenders().filter(function(newSender) {
        return existingSenders.indexOf(newSender) === -1;
      });
      this._shimmedLocalStreams[stream.id] = [stream].concat(newSenders);
    };

    var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      delete this._shimmedLocalStreams[stream.id];
      return origRemoveStream.apply(this, arguments);
    };

    var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
    window.RTCPeerConnection.prototype.removeTrack = function(sender) {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      if (sender) {
        Object.keys(this._shimmedLocalStreams).forEach(function(streamId) {
          var idx = pc._shimmedLocalStreams[streamId].indexOf(sender);
          if (idx !== -1) {
            pc._shimmedLocalStreams[streamId].splice(idx, 1);
          }
          if (pc._shimmedLocalStreams[streamId].length === 1) {
            delete pc._shimmedLocalStreams[streamId];
          }
        });
      }
      return origRemoveTrack.apply(this, arguments);
    };
  },

  shimAddTrackRemoveTrack: function(window) {
    var browserDetails = utils.detectBrowser(window);
    // shim addTrack and removeTrack.
    if (window.RTCPeerConnection.prototype.addTrack &&
        browserDetails.version >= 65) {
      return this.shimAddTrackRemoveTrackWithNative(window);
    }

    // also shim pc.getLocalStreams when addTrack is shimmed
    // to return the original streams.
    var origGetLocalStreams = window.RTCPeerConnection.prototype
        .getLocalStreams;
    window.RTCPeerConnection.prototype.getLocalStreams = function() {
      var pc = this;
      var nativeStreams = origGetLocalStreams.apply(this);
      pc._reverseStreams = pc._reverseStreams || {};
      return nativeStreams.map(function(stream) {
        return pc._reverseStreams[stream.id];
      });
    };

    var origAddStream = window.RTCPeerConnection.prototype.addStream;
    window.RTCPeerConnection.prototype.addStream = function(stream) {
      var pc = this;
      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};

      stream.getTracks().forEach(function(track) {
        var alreadyExists = pc.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException('Track already exists.',
              'InvalidAccessError');
        }
      });
      // Add identity mapping for consistency with addTrack.
      // Unless this is being used with a stream from addTrack.
      if (!pc._reverseStreams[stream.id]) {
        var newStream = new window.MediaStream(stream.getTracks());
        pc._streams[stream.id] = newStream;
        pc._reverseStreams[newStream.id] = stream;
        stream = newStream;
      }
      origAddStream.apply(pc, [stream]);
    };

    var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      var pc = this;
      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};

      origRemoveStream.apply(pc, [(pc._streams[stream.id] || stream)]);
      delete pc._reverseStreams[(pc._streams[stream.id] ?
          pc._streams[stream.id].id : stream.id)];
      delete pc._streams[stream.id];
    };

    window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
      var pc = this;
      if (pc.signalingState === 'closed') {
        throw new DOMException(
          'The RTCPeerConnection\'s signalingState is \'closed\'.',
          'InvalidStateError');
      }
      var streams = [].slice.call(arguments, 1);
      if (streams.length !== 1 ||
          !streams[0].getTracks().find(function(t) {
            return t === track;
          })) {
        // this is not fully correct but all we can manage without
        // [[associated MediaStreams]] internal slot.
        throw new DOMException(
          'The adapter.js addTrack polyfill only supports a single ' +
          ' stream which is associated with the specified track.',
          'NotSupportedError');
      }

      var alreadyExists = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (alreadyExists) {
        throw new DOMException('Track already exists.',
            'InvalidAccessError');
      }

      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};
      var oldStream = pc._streams[stream.id];
      if (oldStream) {
        // this is using odd Chrome behaviour, use with caution:
        // https://bugs.chromium.org/p/webrtc/issues/detail?id=7815
        // Note: we rely on the high-level addTrack/dtmf shim to
        // create the sender with a dtmf sender.
        oldStream.addTrack(track);

        // Trigger ONN async.
        Promise.resolve().then(function() {
          pc.dispatchEvent(new Event('negotiationneeded'));
        });
      } else {
        var newStream = new window.MediaStream([track]);
        pc._streams[stream.id] = newStream;
        pc._reverseStreams[newStream.id] = stream;
        pc.addStream(newStream);
      }
      return pc.getSenders().find(function(s) {
        return s.track === track;
      });
    };

    // replace the internal stream id with the external one and
    // vice versa.
    function replaceInternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(internalStream.id, 'g'),
            externalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp: sdp
      });
    }
    function replaceExternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(externalStream.id, 'g'),
            internalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp: sdp
      });
    }
    ['createOffer', 'createAnswer'].forEach(function(method) {
      var nativeMethod = window.RTCPeerConnection.prototype[method];
      window.RTCPeerConnection.prototype[method] = function() {
        var pc = this;
        var args = arguments;
        var isLegacyCall = arguments.length &&
            typeof arguments[0] === 'function';
        if (isLegacyCall) {
          return nativeMethod.apply(pc, [
            function(description) {
              var desc = replaceInternalStreamId(pc, description);
              args[0].apply(null, [desc]);
            },
            function(err) {
              if (args[1]) {
                args[1].apply(null, err);
              }
            }, arguments[2]
          ]);
        }
        return nativeMethod.apply(pc, arguments)
        .then(function(description) {
          return replaceInternalStreamId(pc, description);
        });
      };
    });

    var origSetLocalDescription =
        window.RTCPeerConnection.prototype.setLocalDescription;
    window.RTCPeerConnection.prototype.setLocalDescription = function() {
      var pc = this;
      if (!arguments.length || !arguments[0].type) {
        return origSetLocalDescription.apply(pc, arguments);
      }
      arguments[0] = replaceExternalStreamId(pc, arguments[0]);
      return origSetLocalDescription.apply(pc, arguments);
    };

    // TODO: mangle getStats: https://w3c.github.io/webrtc-stats/#dom-rtcmediastreamstats-streamidentifier

    var origLocalDescription = Object.getOwnPropertyDescriptor(
        window.RTCPeerConnection.prototype, 'localDescription');
    Object.defineProperty(window.RTCPeerConnection.prototype,
        'localDescription', {
          get: function() {
            var pc = this;
            var description = origLocalDescription.get.apply(this);
            if (description.type === '') {
              return description;
            }
            return replaceInternalStreamId(pc, description);
          }
        });

    window.RTCPeerConnection.prototype.removeTrack = function(sender) {
      var pc = this;
      if (pc.signalingState === 'closed') {
        throw new DOMException(
          'The RTCPeerConnection\'s signalingState is \'closed\'.',
          'InvalidStateError');
      }
      // We can not yet check for sender instanceof RTCRtpSender
      // since we shim RTPSender. So we check if sender._pc is set.
      if (!sender._pc) {
        throw new DOMException('Argument 1 of RTCPeerConnection.removeTrack ' +
            'does not implement interface RTCRtpSender.', 'TypeError');
      }
      var isLocal = sender._pc === pc;
      if (!isLocal) {
        throw new DOMException('Sender was not created by this connection.',
            'InvalidAccessError');
      }

      // Search for the native stream the senders track belongs to.
      pc._streams = pc._streams || {};
      var stream;
      Object.keys(pc._streams).forEach(function(streamid) {
        var hasTrack = pc._streams[streamid].getTracks().find(function(track) {
          return sender.track === track;
        });
        if (hasTrack) {
          stream = pc._streams[streamid];
        }
      });

      if (stream) {
        if (stream.getTracks().length === 1) {
          // if this is the last track of the stream, remove the stream. This
          // takes care of any shimmed _senders.
          pc.removeStream(pc._reverseStreams[stream.id]);
        } else {
          // relying on the same odd chrome behaviour as above.
          stream.removeTrack(sender.track);
        }
        pc.dispatchEvent(new Event('negotiationneeded'));
      }
    };
  },

  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    // The RTCPeerConnection object.
    if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) {
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        // Translate iceTransportPolicy to iceTransports,
        // see https://code.google.com/p/webrtc/issues/detail?id=4869
        // this was fixed in M56 along with unprefixing RTCPeerConnection.
        logging('PeerConnection');
        if (pcConfig && pcConfig.iceTransportPolicy) {
          pcConfig.iceTransports = pcConfig.iceTransportPolicy;
        }

        return new window.webkitRTCPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype =
          window.webkitRTCPeerConnection.prototype;
      // wrap static methods. Currently just generateCertificate.
      if (window.webkitRTCPeerConnection.generateCertificate) {
        Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
          get: function() {
            return window.webkitRTCPeerConnection.generateCertificate;
          }
        });
      }
    } else {
      // migrate from non-spec RTCIceServer.url to RTCIceServer.urls
      var OrigPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        if (pcConfig && pcConfig.iceServers) {
          var newIceServers = [];
          for (var i = 0; i < pcConfig.iceServers.length; i++) {
            var server = pcConfig.iceServers[i];
            if (!server.hasOwnProperty('urls') &&
                server.hasOwnProperty('url')) {
              utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
              server = JSON.parse(JSON.stringify(server));
              server.urls = server.url;
              newIceServers.push(server);
            } else {
              newIceServers.push(pcConfig.iceServers[i]);
            }
          }
          pcConfig.iceServers = newIceServers;
        }
        return new OrigPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
      // wrap static methods. Currently just generateCertificate.
      Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
        get: function() {
          return OrigPeerConnection.generateCertificate;
        }
      });
    }

    var origGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function(selector,
        successCallback, errorCallback) {
      var pc = this;
      var args = arguments;

      // If selector is a function then we are in the old style stats so just
      // pass back the original getStats format to avoid breaking old users.
      if (arguments.length > 0 && typeof selector === 'function') {
        return origGetStats.apply(this, arguments);
      }

      // When spec-style getStats is supported, return those when called with
      // either no arguments or the selector argument is null.
      if (origGetStats.length === 0 && (arguments.length === 0 ||
          typeof arguments[0] !== 'function')) {
        return origGetStats.apply(this, []);
      }

      var fixChromeStats_ = function(response) {
        var standardReport = {};
        var reports = response.result();
        reports.forEach(function(report) {
          var standardStats = {
            id: report.id,
            timestamp: report.timestamp,
            type: {
              localcandidate: 'local-candidate',
              remotecandidate: 'remote-candidate'
            }[report.type] || report.type
          };
          report.names().forEach(function(name) {
            standardStats[name] = report.stat(name);
          });
          standardReport[standardStats.id] = standardStats;
        });

        return standardReport;
      };

      // shim getStats with maplike support
      var makeMapStats = function(stats) {
        return new Map(Object.keys(stats).map(function(key) {
          return [key, stats[key]];
        }));
      };

      if (arguments.length >= 2) {
        var successCallbackWrapper_ = function(response) {
          args[1](makeMapStats(fixChromeStats_(response)));
        };

        return origGetStats.apply(this, [successCallbackWrapper_,
          arguments[0]]);
      }

      // promise-support
      return new Promise(function(resolve, reject) {
        origGetStats.apply(pc, [
          function(response) {
            resolve(makeMapStats(fixChromeStats_(response)));
          }, reject]);
      }).then(successCallback, errorCallback);
    };

    // add promise support -- natively available in Chrome 51
    if (browserDetails.version < 51) {
      ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
          .forEach(function(method) {
            var nativeMethod = window.RTCPeerConnection.prototype[method];
            window.RTCPeerConnection.prototype[method] = function() {
              var args = arguments;
              var pc = this;
              var promise = new Promise(function(resolve, reject) {
                nativeMethod.apply(pc, [args[0], resolve, reject]);
              });
              if (args.length < 2) {
                return promise;
              }
              return promise.then(function() {
                args[1].apply(null, []);
              },
              function(err) {
                if (args.length >= 3) {
                  args[2].apply(null, [err]);
                }
              });
            };
          });
    }

    // promise support for createOffer and createAnswer. Available (without
    // bugs) since M52: crbug/619289
    if (browserDetails.version < 52) {
      ['createOffer', 'createAnswer'].forEach(function(method) {
        var nativeMethod = window.RTCPeerConnection.prototype[method];
        window.RTCPeerConnection.prototype[method] = function() {
          var pc = this;
          if (arguments.length < 1 || (arguments.length === 1 &&
              typeof arguments[0] === 'object')) {
            var opts = arguments.length === 1 ? arguments[0] : undefined;
            return new Promise(function(resolve, reject) {
              nativeMethod.apply(pc, [resolve, reject, opts]);
            });
          }
          return nativeMethod.apply(this, arguments);
        };
      });
    }

    // shim implicit creation of RTCSessionDescription/RTCIceCandidate
    ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
        .forEach(function(method) {
          var nativeMethod = window.RTCPeerConnection.prototype[method];
          window.RTCPeerConnection.prototype[method] = function() {
            arguments[0] = new ((method === 'addIceCandidate') ?
                window.RTCIceCandidate :
                window.RTCSessionDescription)(arguments[0]);
            return nativeMethod.apply(this, arguments);
          };
        });

    // support for addIceCandidate(null or undefined)
    var nativeAddIceCandidate =
        window.RTCPeerConnection.prototype.addIceCandidate;
    window.RTCPeerConnection.prototype.addIceCandidate = function() {
      if (!arguments[0]) {
        if (arguments[1]) {
          arguments[1].apply(null);
        }
        return Promise.resolve();
      }
      return nativeAddIceCandidate.apply(this, arguments);
    };
  }
};

},{"../utils.js":14,"./getusermedia":6}],6:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';
var utils = require('../utils.js');
var logging = utils.log;

// Expose public methods.
module.exports = function(window) {
  var browserDetails = utils.detectBrowser(window);
  var navigator = window && window.navigator;

  var constraintsToChrome_ = function(c) {
    if (typeof c !== 'object' || c.mandatory || c.optional) {
      return c;
    }
    var cc = {};
    Object.keys(c).forEach(function(key) {
      if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
        return;
      }
      var r = (typeof c[key] === 'object') ? c[key] : {ideal: c[key]};
      if (r.exact !== undefined && typeof r.exact === 'number') {
        r.min = r.max = r.exact;
      }
      var oldname_ = function(prefix, name) {
        if (prefix) {
          return prefix + name.charAt(0).toUpperCase() + name.slice(1);
        }
        return (name === 'deviceId') ? 'sourceId' : name;
      };
      if (r.ideal !== undefined) {
        cc.optional = cc.optional || [];
        var oc = {};
        if (typeof r.ideal === 'number') {
          oc[oldname_('min', key)] = r.ideal;
          cc.optional.push(oc);
          oc = {};
          oc[oldname_('max', key)] = r.ideal;
          cc.optional.push(oc);
        } else {
          oc[oldname_('', key)] = r.ideal;
          cc.optional.push(oc);
        }
      }
      if (r.exact !== undefined && typeof r.exact !== 'number') {
        cc.mandatory = cc.mandatory || {};
        cc.mandatory[oldname_('', key)] = r.exact;
      } else {
        ['min', 'max'].forEach(function(mix) {
          if (r[mix] !== undefined) {
            cc.mandatory = cc.mandatory || {};
            cc.mandatory[oldname_(mix, key)] = r[mix];
          }
        });
      }
    });
    if (c.advanced) {
      cc.optional = (cc.optional || []).concat(c.advanced);
    }
    return cc;
  };

  var shimConstraints_ = function(constraints, func) {
    if (browserDetails.version >= 61) {
      return func(constraints);
    }
    constraints = JSON.parse(JSON.stringify(constraints));
    if (constraints && typeof constraints.audio === 'object') {
      var remap = function(obj, a, b) {
        if (a in obj && !(b in obj)) {
          obj[b] = obj[a];
          delete obj[a];
        }
      };
      constraints = JSON.parse(JSON.stringify(constraints));
      remap(constraints.audio, 'autoGainControl', 'googAutoGainControl');
      remap(constraints.audio, 'noiseSuppression', 'googNoiseSuppression');
      constraints.audio = constraintsToChrome_(constraints.audio);
    }
    if (constraints && typeof constraints.video === 'object') {
      // Shim facingMode for mobile & surface pro.
      var face = constraints.video.facingMode;
      face = face && ((typeof face === 'object') ? face : {ideal: face});
      var getSupportedFacingModeLies = browserDetails.version < 66;

      if ((face && (face.exact === 'user' || face.exact === 'environment' ||
                    face.ideal === 'user' || face.ideal === 'environment')) &&
          !(navigator.mediaDevices.getSupportedConstraints &&
            navigator.mediaDevices.getSupportedConstraints().facingMode &&
            !getSupportedFacingModeLies)) {
        delete constraints.video.facingMode;
        var matches;
        if (face.exact === 'environment' || face.ideal === 'environment') {
          matches = ['back', 'rear'];
        } else if (face.exact === 'user' || face.ideal === 'user') {
          matches = ['front'];
        }
        if (matches) {
          // Look for matches in label, or use last cam for back (typical).
          return navigator.mediaDevices.enumerateDevices()
          .then(function(devices) {
            devices = devices.filter(function(d) {
              return d.kind === 'videoinput';
            });
            var dev = devices.find(function(d) {
              return matches.some(function(match) {
                return d.label.toLowerCase().indexOf(match) !== -1;
              });
            });
            if (!dev && devices.length && matches.indexOf('back') !== -1) {
              dev = devices[devices.length - 1]; // more likely the back cam
            }
            if (dev) {
              constraints.video.deviceId = face.exact ? {exact: dev.deviceId} :
                                                        {ideal: dev.deviceId};
            }
            constraints.video = constraintsToChrome_(constraints.video);
            logging('chrome: ' + JSON.stringify(constraints));
            return func(constraints);
          });
        }
      }
      constraints.video = constraintsToChrome_(constraints.video);
    }
    logging('chrome: ' + JSON.stringify(constraints));
    return func(constraints);
  };

  var shimError_ = function(e) {
    return {
      name: {
        PermissionDeniedError: 'NotAllowedError',
        PermissionDismissedError: 'NotAllowedError',
        InvalidStateError: 'NotAllowedError',
        DevicesNotFoundError: 'NotFoundError',
        ConstraintNotSatisfiedError: 'OverconstrainedError',
        TrackStartError: 'NotReadableError',
        MediaDeviceFailedDueToShutdown: 'NotAllowedError',
        MediaDeviceKillSwitchOn: 'NotAllowedError',
        TabCaptureError: 'AbortError',
        ScreenCaptureError: 'AbortError',
        DeviceCaptureError: 'AbortError'
      }[e.name] || e.name,
      message: e.message,
      constraint: e.constraintName,
      toString: function() {
        return this.name + (this.message && ': ') + this.message;
      }
    };
  };

  var getUserMedia_ = function(constraints, onSuccess, onError) {
    shimConstraints_(constraints, function(c) {
      navigator.webkitGetUserMedia(c, onSuccess, function(e) {
        if (onError) {
          onError(shimError_(e));
        }
      });
    });
  };

  navigator.getUserMedia = getUserMedia_;

  // Returns the result of getUserMedia as a Promise.
  var getUserMediaPromise_ = function(constraints) {
    return new Promise(function(resolve, reject) {
      navigator.getUserMedia(constraints, resolve, reject);
    });
  };

  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {
      getUserMedia: getUserMediaPromise_,
      enumerateDevices: function() {
        return new Promise(function(resolve) {
          var kinds = {audio: 'audioinput', video: 'videoinput'};
          return window.MediaStreamTrack.getSources(function(devices) {
            resolve(devices.map(function(device) {
              return {label: device.label,
                kind: kinds[device.kind],
                deviceId: device.id,
                groupId: ''};
            }));
          });
        });
      },
      getSupportedConstraints: function() {
        return {
          deviceId: true, echoCancellation: true, facingMode: true,
          frameRate: true, height: true, width: true
        };
      }
    };
  }

  // A shim for getUserMedia method on the mediaDevices object.
  // TODO(KaptenJansson) remove once implemented in Chrome stable.
  if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints) {
      return getUserMediaPromise_(constraints);
    };
  } else {
    // Even though Chrome 45 has navigator.mediaDevices and a getUserMedia
    // function which returns a Promise, it does not accept spec-style
    // constraints.
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(cs) {
      return shimConstraints_(cs, function(c) {
        return origGetUserMedia(c).then(function(stream) {
          if (c.audio && !stream.getAudioTracks().length ||
              c.video && !stream.getVideoTracks().length) {
            stream.getTracks().forEach(function(track) {
              track.stop();
            });
            throw new DOMException('', 'NotFoundError');
          }
          return stream;
        }, function(e) {
          return Promise.reject(shimError_(e));
        });
      });
    };
  }

  // Dummy devicechange event methods.
  // TODO(KaptenJansson) remove once implemented in Chrome stable.
  if (typeof navigator.mediaDevices.addEventListener === 'undefined') {
    navigator.mediaDevices.addEventListener = function() {
      logging('Dummy mediaDevices.addEventListener called.');
    };
  }
  if (typeof navigator.mediaDevices.removeEventListener === 'undefined') {
    navigator.mediaDevices.removeEventListener = function() {
      logging('Dummy mediaDevices.removeEventListener called.');
    };
  }
};

},{"../utils.js":14}],7:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var SDPUtils = require('sdp');
var utils = require('./utils');

module.exports = {
  shimRTCIceCandidate: function(window) {
    // foundation is arbitrarily chosen as an indicator for full support for
    // https://w3c.github.io/webrtc-pc/#rtcicecandidate-interface
    if (!window.RTCIceCandidate || (window.RTCIceCandidate && 'foundation' in
        window.RTCIceCandidate.prototype)) {
      return;
    }

    var NativeRTCIceCandidate = window.RTCIceCandidate;
    window.RTCIceCandidate = function(args) {
      // Remove the a= which shouldn't be part of the candidate string.
      if (typeof args === 'object' && args.candidate &&
          args.candidate.indexOf('a=') === 0) {
        args = JSON.parse(JSON.stringify(args));
        args.candidate = args.candidate.substr(2);
      }

      if (args.candidate && args.candidate.length) {
        // Augment the native candidate with the parsed fields.
        var nativeCandidate = new NativeRTCIceCandidate(args);
        var parsedCandidate = SDPUtils.parseCandidate(args.candidate);
        var augmentedCandidate = Object.assign(nativeCandidate,
            parsedCandidate);

        // Add a serializer that does not serialize the extra attributes.
        augmentedCandidate.toJSON = function() {
          return {
            candidate: augmentedCandidate.candidate,
            sdpMid: augmentedCandidate.sdpMid,
            sdpMLineIndex: augmentedCandidate.sdpMLineIndex,
            usernameFragment: augmentedCandidate.usernameFragment,
          };
        };
        return augmentedCandidate;
      }
      return new NativeRTCIceCandidate(args);
    };
    window.RTCIceCandidate.prototype = NativeRTCIceCandidate.prototype;

    // Hook up the augmented candidate in onicecandidate and
    // addEventListener('icecandidate', ...)
    utils.wrapPeerConnectionEvent(window, 'icecandidate', function(e) {
      if (e.candidate) {
        Object.defineProperty(e, 'candidate', {
          value: new window.RTCIceCandidate(e.candidate),
          writable: 'false'
        });
      }
      return e;
    });
  },

  // shimCreateObjectURL must be called before shimSourceObject to avoid loop.

  shimCreateObjectURL: function(window) {
    var URL = window && window.URL;

    if (!(typeof window === 'object' && window.HTMLMediaElement &&
          'srcObject' in window.HTMLMediaElement.prototype &&
        URL.createObjectURL && URL.revokeObjectURL)) {
      // Only shim CreateObjectURL using srcObject if srcObject exists.
      return undefined;
    }

    var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    var streams = new Map(), newId = 0;

    URL.createObjectURL = function(stream) {
      if ('getTracks' in stream) {
        var url = 'polyblob:' + (++newId);
        streams.set(url, stream);
        utils.deprecated('URL.createObjectURL(stream)',
            'elem.srcObject = stream');
        return url;
      }
      return nativeCreateObjectURL(stream);
    };
    URL.revokeObjectURL = function(url) {
      nativeRevokeObjectURL(url);
      streams.delete(url);
    };

    var dsc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype,
                                              'src');
    Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
      get: function() {
        return dsc.get.apply(this);
      },
      set: function(url) {
        this.srcObject = streams.get(url) || null;
        return dsc.set.apply(this, [url]);
      }
    });

    var nativeSetAttribute = window.HTMLMediaElement.prototype.setAttribute;
    window.HTMLMediaElement.prototype.setAttribute = function() {
      if (arguments.length === 2 &&
          ('' + arguments[0]).toLowerCase() === 'src') {
        this.srcObject = streams.get(arguments[1]) || null;
      }
      return nativeSetAttribute.apply(this, arguments);
    };
  },

  shimMaxMessageSize: function(window) {
    if (window.RTCSctpTransport || !window.RTCPeerConnection) {
      return;
    }
    var browserDetails = utils.detectBrowser(window);

    if (!('sctp' in window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'sctp', {
        get: function() {
          return typeof this._sctp === 'undefined' ? null : this._sctp;
        }
      });
    }

    var sctpInDescription = function(description) {
      var sections = SDPUtils.splitSections(description.sdp);
      sections.shift();
      return sections.some(function(mediaSection) {
        var mLine = SDPUtils.parseMLine(mediaSection);
        return mLine && mLine.kind === 'application'
            && mLine.protocol.indexOf('SCTP') !== -1;
      });
    };

    var getRemoteFirefoxVersion = function(description) {
      // TODO: Is there a better solution for detecting Firefox?
      var match = description.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);
      if (match === null || match.length < 2) {
        return -1;
      }
      var version = parseInt(match[1], 10);
      // Test for NaN (yes, this is ugly)
      return version !== version ? -1 : version;
    };

    var getCanSendMaxMessageSize = function(remoteIsFirefox) {
      // Every implementation we know can send at least 64 KiB.
      // Note: Although Chrome is technically able to send up to 256 KiB, the
      //       data does not reach the other peer reliably.
      //       See: https://bugs.chromium.org/p/webrtc/issues/detail?id=8419
      var canSendMaxMessageSize = 65536;
      if (browserDetails.browser === 'firefox') {
        if (browserDetails.version < 57) {
          if (remoteIsFirefox === -1) {
            // FF < 57 will send in 16 KiB chunks using the deprecated PPID
            // fragmentation.
            canSendMaxMessageSize = 16384;
          } else {
            // However, other FF (and RAWRTC) can reassemble PPID-fragmented
            // messages. Thus, supporting ~2 GiB when sending.
            canSendMaxMessageSize = 2147483637;
          }
        } else if (browserDetails.version < 60) {
          // Currently, all FF >= 57 will reset the remote maximum message size
          // to the default value when a data channel is created at a later
          // stage. :(
          // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831
          canSendMaxMessageSize =
            browserDetails.version === 57 ? 65535 : 65536;
        } else {
          // FF >= 60 supports sending ~2 GiB
          canSendMaxMessageSize = 2147483637;
        }
      }
      return canSendMaxMessageSize;
    };

    var getMaxMessageSize = function(description, remoteIsFirefox) {
      // Note: 65536 bytes is the default value from the SDP spec. Also,
      //       every implementation we know supports receiving 65536 bytes.
      var maxMessageSize = 65536;

      // FF 57 has a slightly incorrect default remote max message size, so
      // we need to adjust it here to avoid a failure when sending.
      // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1425697
      if (browserDetails.browser === 'firefox'
           && browserDetails.version === 57) {
        maxMessageSize = 65535;
      }

      var match = SDPUtils.matchPrefix(description.sdp, 'a=max-message-size:');
      if (match.length > 0) {
        maxMessageSize = parseInt(match[0].substr(19), 10);
      } else if (browserDetails.browser === 'firefox' &&
                  remoteIsFirefox !== -1) {
        // If the maximum message size is not present in the remote SDP and
        // both local and remote are Firefox, the remote peer can receive
        // ~2 GiB.
        maxMessageSize = 2147483637;
      }
      return maxMessageSize;
    };

    var origSetRemoteDescription =
        window.RTCPeerConnection.prototype.setRemoteDescription;
    window.RTCPeerConnection.prototype.setRemoteDescription = function() {
      var pc = this;
      pc._sctp = null;

      if (sctpInDescription(arguments[0])) {
        // Check if the remote is FF.
        var isFirefox = getRemoteFirefoxVersion(arguments[0]);

        // Get the maximum message size the local peer is capable of sending
        var canSendMMS = getCanSendMaxMessageSize(isFirefox);

        // Get the maximum message size of the remote peer.
        var remoteMMS = getMaxMessageSize(arguments[0], isFirefox);

        // Determine final maximum message size
        var maxMessageSize;
        if (canSendMMS === 0 && remoteMMS === 0) {
          maxMessageSize = Number.POSITIVE_INFINITY;
        } else if (canSendMMS === 0 || remoteMMS === 0) {
          maxMessageSize = Math.max(canSendMMS, remoteMMS);
        } else {
          maxMessageSize = Math.min(canSendMMS, remoteMMS);
        }

        // Create a dummy RTCSctpTransport object and the 'maxMessageSize'
        // attribute.
        var sctp = {};
        Object.defineProperty(sctp, 'maxMessageSize', {
          get: function() {
            return maxMessageSize;
          }
        });
        pc._sctp = sctp;
      }

      return origSetRemoteDescription.apply(pc, arguments);
    };
  },

  shimSendThrowTypeError: function(window) {
    if (!(window.RTCPeerConnection &&
        'createDataChannel' in window.RTCPeerConnection.prototype)) {
      return;
    }

    // Note: Although Firefox >= 57 has a native implementation, the maximum
    //       message size can be reset for all data channels at a later stage.
    //       See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831

    function wrapDcSend(dc, pc) {
      var origDataChannelSend = dc.send;
      dc.send = function() {
        var data = arguments[0];
        var length = data.length || data.size || data.byteLength;
        if (dc.readyState === 'open' &&
            pc.sctp && length > pc.sctp.maxMessageSize) {
          throw new TypeError('Message too large (can send a maximum of ' +
            pc.sctp.maxMessageSize + ' bytes)');
        }
        return origDataChannelSend.apply(dc, arguments);
      };
    }
    var origCreateDataChannel =
      window.RTCPeerConnection.prototype.createDataChannel;
    window.RTCPeerConnection.prototype.createDataChannel = function() {
      var pc = this;
      var dataChannel = origCreateDataChannel.apply(pc, arguments);
      wrapDcSend(dataChannel, pc);
      return dataChannel;
    };
    utils.wrapPeerConnectionEvent(window, 'datachannel', function(e) {
      wrapDcSend(e.channel, e.target);
      return e;
    });
  }
};

},{"./utils":14,"sdp":2}],8:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
var filterIceServers = require('./filtericeservers');
var shimRTCPeerConnection = require('rtcpeerconnection-shim');

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    if (window.RTCIceGatherer) {
      if (!window.RTCIceCandidate) {
        window.RTCIceCandidate = function(args) {
          return args;
        };
      }
      if (!window.RTCSessionDescription) {
        window.RTCSessionDescription = function(args) {
          return args;
        };
      }
      // this adds an additional event listener to MediaStrackTrack that signals
      // when a tracks enabled property was changed. Workaround for a bug in
      // addStream, see below. No longer required in 15025+
      if (browserDetails.version < 15025) {
        var origMSTEnabled = Object.getOwnPropertyDescriptor(
            window.MediaStreamTrack.prototype, 'enabled');
        Object.defineProperty(window.MediaStreamTrack.prototype, 'enabled', {
          set: function(value) {
            origMSTEnabled.set.call(this, value);
            var ev = new Event('enabled');
            ev.enabled = value;
            this.dispatchEvent(ev);
          }
        });
      }
    }

    // ORTC defines the DTMF sender a bit different.
    // https://github.com/w3c/ortc/issues/714
    if (window.RTCRtpSender && !('dtmf' in window.RTCRtpSender.prototype)) {
      Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
        get: function() {
          if (this._dtmf === undefined) {
            if (this.track.kind === 'audio') {
              this._dtmf = new window.RTCDtmfSender(this);
            } else if (this.track.kind === 'video') {
              this._dtmf = null;
            }
          }
          return this._dtmf;
        }
      });
    }
    // Edge currently only implements the RTCDtmfSender, not the
    // RTCDTMFSender alias. See http://draft.ortc.org/#rtcdtmfsender2*
    if (window.RTCDtmfSender && !window.RTCDTMFSender) {
      window.RTCDTMFSender = window.RTCDtmfSender;
    }

    var RTCPeerConnectionShim = shimRTCPeerConnection(window,
        browserDetails.version);
    window.RTCPeerConnection = function(config) {
      if (config && config.iceServers) {
        config.iceServers = filterIceServers(config.iceServers);
      }
      return new RTCPeerConnectionShim(config);
    };
    window.RTCPeerConnection.prototype = RTCPeerConnectionShim.prototype;
  },
  shimReplaceTrack: function(window) {
    // ORTC has replaceTrack -- https://github.com/w3c/ortc/issues/614
    if (window.RTCRtpSender &&
        !('replaceTrack' in window.RTCRtpSender.prototype)) {
      window.RTCRtpSender.prototype.replaceTrack =
          window.RTCRtpSender.prototype.setTrack;
    }
  }
};

},{"../utils":14,"./filtericeservers":9,"./getusermedia":10,"rtcpeerconnection-shim":1}],9:[function(require,module,exports){
/*
 *  Copyright (c) 2018 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
// Edge does not like
// 1) stun: filtered after 14393 unless ?transport=udp is present
// 2) turn: that does not have all of turn:host:port?transport=udp
// 3) turn: with ipv6 addresses
// 4) turn: occurring muliple times
module.exports = function(iceServers, edgeVersion) {
  var hasTurn = false;
  iceServers = JSON.parse(JSON.stringify(iceServers));
  return iceServers.filter(function(server) {
    if (server && (server.urls || server.url)) {
      var urls = server.urls || server.url;
      if (server.url && !server.urls) {
        utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
      }
      var isString = typeof urls === 'string';
      if (isString) {
        urls = [urls];
      }
      urls = urls.filter(function(url) {
        var validTurn = url.indexOf('turn:') === 0 &&
            url.indexOf('transport=udp') !== -1 &&
            url.indexOf('turn:[') === -1 &&
            !hasTurn;

        if (validTurn) {
          hasTurn = true;
          return true;
        }
        return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
            url.indexOf('?transport=udp') === -1;
      });

      delete server.url;
      server.urls = isString ? urls[0] : urls;
      return !!urls.length;
    }
  });
};

},{"../utils":14}],10:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

// Expose public methods.
module.exports = function(window) {
  var navigator = window && window.navigator;

  var shimError_ = function(e) {
    return {
      name: {PermissionDeniedError: 'NotAllowedError'}[e.name] || e.name,
      message: e.message,
      constraint: e.constraint,
      toString: function() {
        return this.name;
      }
    };
  };

  // getUserMedia error shim.
  var origGetUserMedia = navigator.mediaDevices.getUserMedia.
      bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function(c) {
    return origGetUserMedia(c).catch(function(e) {
      return Promise.reject(shimError_(e));
    });
  };
};

},{}],11:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimOnTrack: function(window) {
    if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
        window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
        get: function() {
          return this._ontrack;
        },
        set: function(f) {
          if (this._ontrack) {
            this.removeEventListener('track', this._ontrack);
            this.removeEventListener('addstream', this._ontrackpoly);
          }
          this.addEventListener('track', this._ontrack = f);
          this.addEventListener('addstream', this._ontrackpoly = function(e) {
            e.stream.getTracks().forEach(function(track) {
              var event = new Event('track');
              event.track = track;
              event.receiver = {track: track};
              event.transceiver = {receiver: event.receiver};
              event.streams = [e.stream];
              this.dispatchEvent(event);
            }.bind(this));
          }.bind(this));
        }
      });
    }
    if (typeof window === 'object' && window.RTCTrackEvent &&
        ('receiver' in window.RTCTrackEvent.prototype) &&
        !('transceiver' in window.RTCTrackEvent.prototype)) {
      Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
        get: function() {
          return {receiver: this.receiver};
        }
      });
    }
  },

  shimSourceObject: function(window) {
    // Firefox has supported mozSrcObject since FF22, unprefixed in 42.
    if (typeof window === 'object') {
      if (window.HTMLMediaElement &&
        !('srcObject' in window.HTMLMediaElement.prototype)) {
        // Shim the srcObject property, once, when HTMLMediaElement is found.
        Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
          get: function() {
            return this.mozSrcObject;
          },
          set: function(stream) {
            this.mozSrcObject = stream;
          }
        });
      }
    }
  },

  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    if (typeof window !== 'object' || !(window.RTCPeerConnection ||
        window.mozRTCPeerConnection)) {
      return; // probably media.peerconnection.enabled=false in about:config
    }
    // The RTCPeerConnection object.
    if (!window.RTCPeerConnection) {
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        if (browserDetails.version < 38) {
          // .urls is not supported in FF < 38.
          // create RTCIceServers with a single url.
          if (pcConfig && pcConfig.iceServers) {
            var newIceServers = [];
            for (var i = 0; i < pcConfig.iceServers.length; i++) {
              var server = pcConfig.iceServers[i];
              if (server.hasOwnProperty('urls')) {
                for (var j = 0; j < server.urls.length; j++) {
                  var newServer = {
                    url: server.urls[j]
                  };
                  if (server.urls[j].indexOf('turn') === 0) {
                    newServer.username = server.username;
                    newServer.credential = server.credential;
                  }
                  newIceServers.push(newServer);
                }
              } else {
                newIceServers.push(pcConfig.iceServers[i]);
              }
            }
            pcConfig.iceServers = newIceServers;
          }
        }
        return new window.mozRTCPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype =
          window.mozRTCPeerConnection.prototype;

      // wrap static methods. Currently just generateCertificate.
      if (window.mozRTCPeerConnection.generateCertificate) {
        Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
          get: function() {
            return window.mozRTCPeerConnection.generateCertificate;
          }
        });
      }

      window.RTCSessionDescription = window.mozRTCSessionDescription;
      window.RTCIceCandidate = window.mozRTCIceCandidate;
    }

    // shim away need for obsolete RTCIceCandidate/RTCSessionDescription.
    ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
        .forEach(function(method) {
          var nativeMethod = window.RTCPeerConnection.prototype[method];
          window.RTCPeerConnection.prototype[method] = function() {
            arguments[0] = new ((method === 'addIceCandidate') ?
                window.RTCIceCandidate :
                window.RTCSessionDescription)(arguments[0]);
            return nativeMethod.apply(this, arguments);
          };
        });

    // support for addIceCandidate(null or undefined)
    var nativeAddIceCandidate =
        window.RTCPeerConnection.prototype.addIceCandidate;
    window.RTCPeerConnection.prototype.addIceCandidate = function() {
      if (!arguments[0]) {
        if (arguments[1]) {
          arguments[1].apply(null);
        }
        return Promise.resolve();
      }
      return nativeAddIceCandidate.apply(this, arguments);
    };

    // shim getStats with maplike support
    var makeMapStats = function(stats) {
      var map = new Map();
      Object.keys(stats).forEach(function(key) {
        map.set(key, stats[key]);
        map[key] = stats[key];
      });
      return map;
    };

    var modernStatsTypes = {
      inboundrtp: 'inbound-rtp',
      outboundrtp: 'outbound-rtp',
      candidatepair: 'candidate-pair',
      localcandidate: 'local-candidate',
      remotecandidate: 'remote-candidate'
    };

    var nativeGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function(
      selector,
      onSucc,
      onErr
    ) {
      return nativeGetStats.apply(this, [selector || null])
        .then(function(stats) {
          if (browserDetails.version < 48) {
            stats = makeMapStats(stats);
          }
          if (browserDetails.version < 53 && !onSucc) {
            // Shim only promise getStats with spec-hyphens in type names
            // Leave callback version alone; misc old uses of forEach before Map
            try {
              stats.forEach(function(stat) {
                stat.type = modernStatsTypes[stat.type] || stat.type;
              });
            } catch (e) {
              if (e.name !== 'TypeError') {
                throw e;
              }
              // Avoid TypeError: "type" is read-only, in old versions. 34-43ish
              stats.forEach(function(stat, i) {
                stats.set(i, Object.assign({}, stat, {
                  type: modernStatsTypes[stat.type] || stat.type
                }));
              });
            }
          }
          return stats;
        })
        .then(onSucc, onErr);
    };
  },

  shimSenderGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender)) {
      return;
    }
    if (window.RTCRtpSender && 'getStats' in window.RTCRtpSender.prototype) {
      return;
    }
    var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
    if (origGetSenders) {
      window.RTCPeerConnection.prototype.getSenders = function() {
        var pc = this;
        var senders = origGetSenders.apply(pc, []);
        senders.forEach(function(sender) {
          sender._pc = pc;
        });
        return senders;
      };
    }

    var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
    if (origAddTrack) {
      window.RTCPeerConnection.prototype.addTrack = function() {
        var sender = origAddTrack.apply(this, arguments);
        sender._pc = this;
        return sender;
      };
    }
    window.RTCRtpSender.prototype.getStats = function() {
      return this.track ? this._pc.getStats(this.track) :
          Promise.resolve(new Map());
    };
  },

  shimReceiverGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender)) {
      return;
    }
    if (window.RTCRtpSender && 'getStats' in window.RTCRtpReceiver.prototype) {
      return;
    }
    var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
    if (origGetReceivers) {
      window.RTCPeerConnection.prototype.getReceivers = function() {
        var pc = this;
        var receivers = origGetReceivers.apply(pc, []);
        receivers.forEach(function(receiver) {
          receiver._pc = pc;
        });
        return receivers;
      };
    }
    utils.wrapPeerConnectionEvent(window, 'track', function(e) {
      e.receiver._pc = e.srcElement;
      return e;
    });
    window.RTCRtpReceiver.prototype.getStats = function() {
      return this._pc.getStats(this.track);
    };
  },

  shimRemoveStream: function(window) {
    if (!window.RTCPeerConnection ||
        'removeStream' in window.RTCPeerConnection.prototype) {
      return;
    }
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      var pc = this;
      utils.deprecated('removeStream', 'removeTrack');
      this.getSenders().forEach(function(sender) {
        if (sender.track && stream.getTracks().indexOf(sender.track) !== -1) {
          pc.removeTrack(sender);
        }
      });
    };
  },

  shimRTCDataChannel: function(window) {
    // rename DataChannel to RTCDataChannel (native fix in FF60):
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1173851
    if (window.DataChannel && !window.RTCDataChannel) {
      window.RTCDataChannel = window.DataChannel;
    }
  },
};

},{"../utils":14,"./getusermedia":12}],12:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
var logging = utils.log;

// Expose public methods.
module.exports = function(window) {
  var browserDetails = utils.detectBrowser(window);
  var navigator = window && window.navigator;
  var MediaStreamTrack = window && window.MediaStreamTrack;

  var shimError_ = function(e) {
    return {
      name: {
        InternalError: 'NotReadableError',
        NotSupportedError: 'TypeError',
        PermissionDeniedError: 'NotAllowedError',
        SecurityError: 'NotAllowedError'
      }[e.name] || e.name,
      message: {
        'The operation is insecure.': 'The request is not allowed by the ' +
        'user agent or the platform in the current context.'
      }[e.message] || e.message,
      constraint: e.constraint,
      toString: function() {
        return this.name + (this.message && ': ') + this.message;
      }
    };
  };

  // getUserMedia constraints shim.
  var getUserMedia_ = function(constraints, onSuccess, onError) {
    var constraintsToFF37_ = function(c) {
      if (typeof c !== 'object' || c.require) {
        return c;
      }
      var require = [];
      Object.keys(c).forEach(function(key) {
        if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
          return;
        }
        var r = c[key] = (typeof c[key] === 'object') ?
            c[key] : {ideal: c[key]};
        if (r.min !== undefined ||
            r.max !== undefined || r.exact !== undefined) {
          require.push(key);
        }
        if (r.exact !== undefined) {
          if (typeof r.exact === 'number') {
            r. min = r.max = r.exact;
          } else {
            c[key] = r.exact;
          }
          delete r.exact;
        }
        if (r.ideal !== undefined) {
          c.advanced = c.advanced || [];
          var oc = {};
          if (typeof r.ideal === 'number') {
            oc[key] = {min: r.ideal, max: r.ideal};
          } else {
            oc[key] = r.ideal;
          }
          c.advanced.push(oc);
          delete r.ideal;
          if (!Object.keys(r).length) {
            delete c[key];
          }
        }
      });
      if (require.length) {
        c.require = require;
      }
      return c;
    };
    constraints = JSON.parse(JSON.stringify(constraints));
    if (browserDetails.version < 38) {
      logging('spec: ' + JSON.stringify(constraints));
      if (constraints.audio) {
        constraints.audio = constraintsToFF37_(constraints.audio);
      }
      if (constraints.video) {
        constraints.video = constraintsToFF37_(constraints.video);
      }
      logging('ff37: ' + JSON.stringify(constraints));
    }
    return navigator.mozGetUserMedia(constraints, onSuccess, function(e) {
      onError(shimError_(e));
    });
  };

  // Returns the result of getUserMedia as a Promise.
  var getUserMediaPromise_ = function(constraints) {
    return new Promise(function(resolve, reject) {
      getUserMedia_(constraints, resolve, reject);
    });
  };

  // Shim for mediaDevices on older versions.
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {getUserMedia: getUserMediaPromise_,
      addEventListener: function() { },
      removeEventListener: function() { }
    };
  }
  navigator.mediaDevices.enumerateDevices =
      navigator.mediaDevices.enumerateDevices || function() {
        return new Promise(function(resolve) {
          var infos = [
            {kind: 'audioinput', deviceId: 'default', label: '', groupId: ''},
            {kind: 'videoinput', deviceId: 'default', label: '', groupId: ''}
          ];
          resolve(infos);
        });
      };

  if (browserDetails.version < 41) {
    // Work around http://bugzil.la/1169665
    var orgEnumerateDevices =
        navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = function() {
      return orgEnumerateDevices().then(undefined, function(e) {
        if (e.name === 'NotFoundError') {
          return [];
        }
        throw e;
      });
    };
  }
  if (browserDetails.version < 49) {
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(c) {
      return origGetUserMedia(c).then(function(stream) {
        // Work around https://bugzil.la/802326
        if (c.audio && !stream.getAudioTracks().length ||
            c.video && !stream.getVideoTracks().length) {
          stream.getTracks().forEach(function(track) {
            track.stop();
          });
          throw new DOMException('The object can not be found here.',
                                 'NotFoundError');
        }
        return stream;
      }, function(e) {
        return Promise.reject(shimError_(e));
      });
    };
  }
  if (!(browserDetails.version > 55 &&
      'autoGainControl' in navigator.mediaDevices.getSupportedConstraints())) {
    var remap = function(obj, a, b) {
      if (a in obj && !(b in obj)) {
        obj[b] = obj[a];
        delete obj[a];
      }
    };

    var nativeGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(c) {
      if (typeof c === 'object' && typeof c.audio === 'object') {
        c = JSON.parse(JSON.stringify(c));
        remap(c.audio, 'autoGainControl', 'mozAutoGainControl');
        remap(c.audio, 'noiseSuppression', 'mozNoiseSuppression');
      }
      return nativeGetUserMedia(c);
    };

    if (MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
      var nativeGetSettings = MediaStreamTrack.prototype.getSettings;
      MediaStreamTrack.prototype.getSettings = function() {
        var obj = nativeGetSettings.apply(this, arguments);
        remap(obj, 'mozAutoGainControl', 'autoGainControl');
        remap(obj, 'mozNoiseSuppression', 'noiseSuppression');
        return obj;
      };
    }

    if (MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints) {
      var nativeApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
      MediaStreamTrack.prototype.applyConstraints = function(c) {
        if (this.kind === 'audio' && typeof c === 'object') {
          c = JSON.parse(JSON.stringify(c));
          remap(c, 'autoGainControl', 'mozAutoGainControl');
          remap(c, 'noiseSuppression', 'mozNoiseSuppression');
        }
        return nativeApplyConstraints.apply(this, [c]);
      };
    }
  }
  navigator.getUserMedia = function(constraints, onSuccess, onError) {
    if (browserDetails.version < 44) {
      return getUserMedia_(constraints, onSuccess, onError);
    }
    // Replace Firefox 44+'s deprecation warning with unprefixed version.
    utils.deprecated('navigator.getUserMedia',
        'navigator.mediaDevices.getUserMedia');
    navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
  };
};

},{"../utils":14}],13:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
var utils = require('../utils');

module.exports = {
  shimLocalStreamsAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    if (!('getLocalStreams' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getLocalStreams = function() {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        return this._localStreams;
      };
    }
    if (!('getStreamById' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getStreamById = function(id) {
        var result = null;
        if (this._localStreams) {
          this._localStreams.forEach(function(stream) {
            if (stream.id === id) {
              result = stream;
            }
          });
        }
        if (this._remoteStreams) {
          this._remoteStreams.forEach(function(stream) {
            if (stream.id === id) {
              result = stream;
            }
          });
        }
        return result;
      };
    }
    if (!('addStream' in window.RTCPeerConnection.prototype)) {
      var _addTrack = window.RTCPeerConnection.prototype.addTrack;
      window.RTCPeerConnection.prototype.addStream = function(stream) {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        if (this._localStreams.indexOf(stream) === -1) {
          this._localStreams.push(stream);
        }
        var pc = this;
        stream.getTracks().forEach(function(track) {
          _addTrack.call(pc, track, stream);
        });
      };

      window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
        if (stream) {
          if (!this._localStreams) {
            this._localStreams = [stream];
          } else if (this._localStreams.indexOf(stream) === -1) {
            this._localStreams.push(stream);
          }
        }
        return _addTrack.call(this, track, stream);
      };
    }
    if (!('removeStream' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.removeStream = function(stream) {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        var index = this._localStreams.indexOf(stream);
        if (index === -1) {
          return;
        }
        this._localStreams.splice(index, 1);
        var pc = this;
        var tracks = stream.getTracks();
        this.getSenders().forEach(function(sender) {
          if (tracks.indexOf(sender.track) !== -1) {
            pc.removeTrack(sender);
          }
        });
      };
    }
  },
  shimRemoteStreamsAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    if (!('getRemoteStreams' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getRemoteStreams = function() {
        return this._remoteStreams ? this._remoteStreams : [];
      };
    }
    if (!('onaddstream' in window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'onaddstream', {
        get: function() {
          return this._onaddstream;
        },
        set: function(f) {
          var pc = this;
          if (this._onaddstream) {
            this.removeEventListener('addstream', this._onaddstream);
            this.removeEventListener('track', this._onaddstreampoly);
          }
          this.addEventListener('addstream', this._onaddstream = f);
          this.addEventListener('track', this._onaddstreampoly = function(e) {
            e.streams.forEach(function(stream) {
              if (!pc._remoteStreams) {
                pc._remoteStreams = [];
              }
              if (pc._remoteStreams.indexOf(stream) >= 0) {
                return;
              }
              pc._remoteStreams.push(stream);
              var event = new Event('addstream');
              event.stream = stream;
              pc.dispatchEvent(event);
            });
          });
        }
      });
    }
  },
  shimCallbacksAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    var prototype = window.RTCPeerConnection.prototype;
    var createOffer = prototype.createOffer;
    var createAnswer = prototype.createAnswer;
    var setLocalDescription = prototype.setLocalDescription;
    var setRemoteDescription = prototype.setRemoteDescription;
    var addIceCandidate = prototype.addIceCandidate;

    prototype.createOffer = function(successCallback, failureCallback) {
      var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
      var promise = createOffer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };

    prototype.createAnswer = function(successCallback, failureCallback) {
      var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
      var promise = createAnswer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };

    var withCallback = function(description, successCallback, failureCallback) {
      var promise = setLocalDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setLocalDescription = withCallback;

    withCallback = function(description, successCallback, failureCallback) {
      var promise = setRemoteDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setRemoteDescription = withCallback;

    withCallback = function(candidate, successCallback, failureCallback) {
      var promise = addIceCandidate.apply(this, [candidate]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.addIceCandidate = withCallback;
  },
  shimGetUserMedia: function(window) {
    var navigator = window && window.navigator;

    if (!navigator.getUserMedia) {
      if (navigator.webkitGetUserMedia) {
        navigator.getUserMedia = navigator.webkitGetUserMedia.bind(navigator);
      } else if (navigator.mediaDevices &&
          navigator.mediaDevices.getUserMedia) {
        navigator.getUserMedia = function(constraints, cb, errcb) {
          navigator.mediaDevices.getUserMedia(constraints)
          .then(cb, errcb);
        }.bind(navigator);
      }
    }
  },
  shimRTCIceServerUrls: function(window) {
    // migrate from non-spec RTCIceServer.url to RTCIceServer.urls
    var OrigPeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function(pcConfig, pcConstraints) {
      if (pcConfig && pcConfig.iceServers) {
        var newIceServers = [];
        for (var i = 0; i < pcConfig.iceServers.length; i++) {
          var server = pcConfig.iceServers[i];
          if (!server.hasOwnProperty('urls') &&
              server.hasOwnProperty('url')) {
            utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
            server = JSON.parse(JSON.stringify(server));
            server.urls = server.url;
            delete server.url;
            newIceServers.push(server);
          } else {
            newIceServers.push(pcConfig.iceServers[i]);
          }
        }
        pcConfig.iceServers = newIceServers;
      }
      return new OrigPeerConnection(pcConfig, pcConstraints);
    };
    window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
    // wrap static methods. Currently just generateCertificate.
    if ('generateCertificate' in window.RTCPeerConnection) {
      Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
        get: function() {
          return OrigPeerConnection.generateCertificate;
        }
      });
    }
  },
  shimTrackEventTransceiver: function(window) {
    // Add event.transceiver member over deprecated event.receiver
    if (typeof window === 'object' && window.RTCPeerConnection &&
        ('receiver' in window.RTCTrackEvent.prototype) &&
        // can't check 'transceiver' in window.RTCTrackEvent.prototype, as it is
        // defined for some reason even when window.RTCTransceiver is not.
        !window.RTCTransceiver) {
      Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
        get: function() {
          return {receiver: this.receiver};
        }
      });
    }
  },

  shimCreateOfferLegacy: function(window) {
    var origCreateOffer = window.RTCPeerConnection.prototype.createOffer;
    window.RTCPeerConnection.prototype.createOffer = function(offerOptions) {
      var pc = this;
      if (offerOptions) {
        if (typeof offerOptions.offerToReceiveAudio !== 'undefined') {
          // support bit values
          offerOptions.offerToReceiveAudio = !!offerOptions.offerToReceiveAudio;
        }
        var audioTransceiver = pc.getTransceivers().find(function(transceiver) {
          return transceiver.sender.track &&
              transceiver.sender.track.kind === 'audio';
        });
        if (offerOptions.offerToReceiveAudio === false && audioTransceiver) {
          if (audioTransceiver.direction === 'sendrecv') {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection('sendonly');
            } else {
              audioTransceiver.direction = 'sendonly';
            }
          } else if (audioTransceiver.direction === 'recvonly') {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection('inactive');
            } else {
              audioTransceiver.direction = 'inactive';
            }
          }
        } else if (offerOptions.offerToReceiveAudio === true &&
            !audioTransceiver) {
          pc.addTransceiver('audio');
        }


        if (typeof offerOptions.offerToReceiveAudio !== 'undefined') {
          // support bit values
          offerOptions.offerToReceiveVideo = !!offerOptions.offerToReceiveVideo;
        }
        var videoTransceiver = pc.getTransceivers().find(function(transceiver) {
          return transceiver.sender.track &&
              transceiver.sender.track.kind === 'video';
        });
        if (offerOptions.offerToReceiveVideo === false && videoTransceiver) {
          if (videoTransceiver.direction === 'sendrecv') {
            videoTransceiver.setDirection('sendonly');
          } else if (videoTransceiver.direction === 'recvonly') {
            videoTransceiver.setDirection('inactive');
          }
        } else if (offerOptions.offerToReceiveVideo === true &&
            !videoTransceiver) {
          pc.addTransceiver('video');
        }
      }
      return origCreateOffer.apply(pc, arguments);
    };
  }
};

},{"../utils":14}],14:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var logDisabled_ = true;
var deprecationWarnings_ = true;

/**
 * Extract browser version out of the provided user agent string.
 *
 * @param {!string} uastring userAgent string.
 * @param {!string} expr Regular expression used as match criteria.
 * @param {!number} pos position in the version string to be returned.
 * @return {!number} browser version.
 */
function extractVersion(uastring, expr, pos) {
  var match = uastring.match(expr);
  return match && match.length >= pos && parseInt(match[pos], 10);
}

// Wraps the peerconnection event eventNameToWrap in a function
// which returns the modified event object.
function wrapPeerConnectionEvent(window, eventNameToWrap, wrapper) {
  if (!window.RTCPeerConnection) {
    return;
  }
  var proto = window.RTCPeerConnection.prototype;
  var nativeAddEventListener = proto.addEventListener;
  proto.addEventListener = function(nativeEventName, cb) {
    if (nativeEventName !== eventNameToWrap) {
      return nativeAddEventListener.apply(this, arguments);
    }
    var wrappedCallback = function(e) {
      cb(wrapper(e));
    };
    this._eventMap = this._eventMap || {};
    this._eventMap[cb] = wrappedCallback;
    return nativeAddEventListener.apply(this, [nativeEventName,
      wrappedCallback]);
  };

  var nativeRemoveEventListener = proto.removeEventListener;
  proto.removeEventListener = function(nativeEventName, cb) {
    if (nativeEventName !== eventNameToWrap || !this._eventMap
        || !this._eventMap[cb]) {
      return nativeRemoveEventListener.apply(this, arguments);
    }
    var unwrappedCb = this._eventMap[cb];
    delete this._eventMap[cb];
    return nativeRemoveEventListener.apply(this, [nativeEventName,
      unwrappedCb]);
  };

  Object.defineProperty(proto, 'on' + eventNameToWrap, {
    get: function() {
      return this['_on' + eventNameToWrap];
    },
    set: function(cb) {
      if (this['_on' + eventNameToWrap]) {
        this.removeEventListener(eventNameToWrap,
            this['_on' + eventNameToWrap]);
        delete this['_on' + eventNameToWrap];
      }
      if (cb) {
        this.addEventListener(eventNameToWrap,
            this['_on' + eventNameToWrap] = cb);
      }
    },
    enumerable: true,
    configurable: true
  });
}

// Utility methods.
module.exports = {
  extractVersion: extractVersion,
  wrapPeerConnectionEvent: wrapPeerConnectionEvent,
  disableLog: function(bool) {
    if (typeof bool !== 'boolean') {
      return new Error('Argument type: ' + typeof bool +
          '. Please use a boolean.');
    }
    logDisabled_ = bool;
    return (bool) ? 'adapter.js logging disabled' :
        'adapter.js logging enabled';
  },

  /**
   * Disable or enable deprecation warnings
   * @param {!boolean} bool set to true to disable warnings.
   */
  disableWarnings: function(bool) {
    if (typeof bool !== 'boolean') {
      return new Error('Argument type: ' + typeof bool +
          '. Please use a boolean.');
    }
    deprecationWarnings_ = !bool;
    return 'adapter.js deprecation warnings ' + (bool ? 'disabled' : 'enabled');
  },

  log: function() {
    if (typeof window === 'object') {
      if (logDisabled_) {
        return;
      }
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log.apply(console, arguments);
      }
    }
  },

  /**
   * Shows a deprecation warning suggesting the modern and spec-compatible API.
   */
  deprecated: function(oldMethod, newMethod) {
    if (!deprecationWarnings_) {
      return;
    }
    console.warn(oldMethod + ' is deprecated, please use ' + newMethod +
        ' instead.');
  },

  /**
   * Browser detector.
   *
   * @return {object} result containing browser and version
   *     properties.
   */
  detectBrowser: function(window) {
    var navigator = window && window.navigator;

    // Returned result object.
    var result = {};
    result.browser = null;
    result.version = null;

    // Fail early if it's not a browser
    if (typeof window === 'undefined' || !window.navigator) {
      result.browser = 'Not a browser.';
      return result;
    }

    if (navigator.mozGetUserMedia) { // Firefox.
      result.browser = 'firefox';
      result.version = extractVersion(navigator.userAgent,
          /Firefox\/(\d+)\./, 1);
    } else if (navigator.webkitGetUserMedia) {
      // Chrome, Chromium, Webview, Opera.
      // Version matches Chrome/WebRTC version.
      result.browser = 'chrome';
      result.version = extractVersion(navigator.userAgent,
          /Chrom(e|ium)\/(\d+)\./, 2);
    } else if (navigator.mediaDevices &&
        navigator.userAgent.match(/Edge\/(\d+).(\d+)$/)) { // Edge.
      result.browser = 'edge';
      result.version = extractVersion(navigator.userAgent,
          /Edge\/(\d+).(\d+)$/, 2);
    } else if (window.RTCPeerConnection &&
        navigator.userAgent.match(/AppleWebKit\/(\d+)\./)) { // Safari.
      result.browser = 'safari';
      result.version = extractVersion(navigator.userAgent,
          /AppleWebKit\/(\d+)\./, 1);
    } else { // Default fallthrough: not supported.
      result.browser = 'Not a supported browser.';
      return result;
    }

    return result;
  }
};

},{}],15:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUITES = exports.TESTS = undefined;
exports.buildMicroSuite = buildMicroSuite;
exports.buildCameraSuite = buildCameraSuite;
exports.buildNetworkSuite = buildNetworkSuite;
exports.buildConnectivitySuite = buildConnectivitySuite;
exports.buildThroughputSuite = buildThroughputSuite;

var _mic = require('../unit/mic.js');

var _mic2 = _interopRequireDefault(_mic);

var _conn = require('../unit/conn.js');

var _conn2 = _interopRequireDefault(_conn);

var _camresolutions = require('../unit/camresolutions.js');

var _camresolutions2 = _interopRequireDefault(_camresolutions);

var _net = require('../unit/net.js');

var _net2 = _interopRequireDefault(_net);

var _dataBandwidth = require('../unit/dataBandwidth.js');

var _dataBandwidth2 = _interopRequireDefault(_dataBandwidth);

var _videoBandwidth = require('../unit/videoBandwidth.js');

var _videoBandwidth2 = _interopRequireDefault(_videoBandwidth);

var _wifiPeriodicScan = require('../unit/wifiPeriodicScan.js');

var _wifiPeriodicScan2 = _interopRequireDefault(_wifiPeriodicScan);

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

var _suite = require('./suite.js');

var _suite2 = _interopRequireDefault(_suite);

var _testCase = require('./testCase.js');

var _testCase2 = _interopRequireDefault(_testCase);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var TESTS = exports.TESTS = {
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

var SUITES = exports.SUITES = {
  CAMERA: 'Camera',
  MICROPHONE: 'Microphone',
  NETWORK: 'Network',
  CONNECTIVITY: 'Connectivity',
  THROUGHPUT: 'Throughput'
};

function buildMicroSuite(config) {
  var micSuite = new _suite2.default(SUITES.MICROPHONE, config);
  micSuite.add(new _testCase2.default(micSuite, TESTS.AUDIOCAPTURE, function (test) {
    var micTest = new _mic2.default(test);
    micTest.run();
  }));
  return micSuite;
}

function buildCameraSuite(config) {
  var cameraSuite = new _suite2.default(SUITES.CAMERA, config);
  cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION240, function (test) {
    var camResolutionsTest = new _camresolutions2.default(test, [[320, 240]]);
    camResolutionsTest.run();
  }));
  cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION480, function (test) {
    var camResolutionsTest = new _camresolutions2.default(test, [[640, 480]]);
    camResolutionsTest.run();
  }));
  cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION720, function (test) {
    var camResolutionsTest = new _camresolutions2.default(test, [[1280, 720]]);
    camResolutionsTest.run();
  }));
  cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKSUPPORTEDRESOLUTIONS, function (test) {
    var resolutionArray = [[160, 120], [320, 180], [320, 240], [640, 360], [640, 480], [768, 576], [1024, 576], [1280, 720], [1280, 768], [1280, 800], [1920, 1080], [1920, 1200], [3840, 2160], [4096, 2160]];
    var camResolutionsTest = new _camresolutions2.default(test, resolutionArray);
    camResolutionsTest.run();
  }));
  return cameraSuite;
}

function buildNetworkSuite(config) {
  var networkSuite = new _suite2.default(SUITES.NETWORK, config);
  // Test whether it can connect via UDP to a TURN server
  // Get a TURN config, and try to get a relay candidate using UDP.
  networkSuite.add(new _testCase2.default(networkSuite, TESTS.UDPENABLED, function (test) {
    var networkTest = new _net2.default(test, 'udp', null, _call2.default.isRelay);
    networkTest.run();
  }));
  // Test whether it can connect via TCP to a TURN server
  // Get a TURN config, and try to get a relay candidate using TCP.
  networkSuite.add(new _testCase2.default(networkSuite, TESTS.TCPENABLED, function (test) {
    var networkTest = new _net2.default(test, 'tcp', null, _call2.default.isRelay);
    networkTest.run();
  }));
  // Test whether it is IPv6 enabled (TODO: test IPv6 to a destination).
  // Turn on IPv6, and try to get an IPv6 host candidate.
  networkSuite.add(new _testCase2.default(networkSuite, TESTS.IPV6ENABLED, function (test) {
    var params = { optional: [{ googIPv6: true }] };
    var networkTest = new _net2.default(test, null, params, _call2.default.isIpv6);
    networkTest.run();
  }));
  return networkSuite;
}

function buildConnectivitySuite(config) {
  var connectivitySuite = new _suite2.default(SUITES.CONNECTIVITY, config);
  // Set up a datachannel between two peers through a relay
  // and verify data can be transmitted and received
  // (packets travel through the public internet)
  connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.RELAYCONNECTIVITY, function (test) {
    var runConnectivityTest = new _conn2.default(test, _call2.default.isRelay);
    runConnectivityTest.run();
  }));
  // Set up a datachannel between two peers through a public IP address
  // and verify data can be transmitted and received
  // (packets should stay on the link if behind a router doing NAT)
  connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.REFLEXIVECONNECTIVITY, function (test) {
    var runConnectivityTest = new _conn2.default(test, _call2.default.isReflexive);
    runConnectivityTest.run();
  }));
  // Set up a datachannel between two peers through a local IP address
  // and verify data can be transmitted and received
  // (packets should not leave the machine running the test)
  connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.HOSTCONNECTIVITY, function (test) {
    var runConnectivityTest = new _conn2.default(test, _call2.default.isHost);
    runConnectivityTest.start();
  }));
  return connectivitySuite;
}

function buildThroughputSuite(config) {
  var throughputSuite = new _suite2.default(SUITES.THROUGHPUT, config);
  // Creates a loopback via relay candidates and tries to send as many packets
  // with 1024 chars as possible while keeping dataChannel bufferedAmmount above
  // zero.
  throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.DATATHROUGHPUT, function (test) {
    var dataChannelThroughputTest = new _dataBandwidth2.default(test);
    dataChannelThroughputTest.run();
  }));
  // Measures video bandwidth estimation performance by doing a loopback call via
  // relay candidates for 40 seconds. Computes rtt and bandwidth estimation
  // average and maximum as well as time to ramp up (defined as reaching 75% of
  // the max bitrate. It reports infinite time to ramp up if never reaches it.
  throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.VIDEOBANDWIDTH, function (test) {
    var videoBandwidthTest = new _videoBandwidth2.default(test);
    videoBandwidthTest.run();
  }));
  throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.NETWORKLATENCY, function (test) {
    var wiFiPeriodicScanTest = new _wifiPeriodicScan2.default(test, _call2.default.isNotHostCandidate);
    wiFiPeriodicScanTest.run();
  }));
  throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.NETWORKLATENCYRELAY, function (test) {
    var wiFiPeriodicScanTest = new _wifiPeriodicScan2.default(test, _call2.default.isRelay);
    wiFiPeriodicScanTest.run();
  }));
  return throughputSuite;
}

},{"../unit/camresolutions.js":20,"../unit/conn.js":21,"../unit/dataBandwidth.js":22,"../unit/mic.js":23,"../unit/net.js":24,"../unit/videoBandwidth.js":25,"../unit/wifiPeriodicScan.js":26,"../util/call.js":29,"./suite.js":16,"./testCase.js":17}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Suite = function () {
  function Suite(name, config) {
    _classCallCheck(this, Suite);

    this.name = name;
    this.settings = config;
    this.tests = [];
  }

  _createClass(Suite, [{
    key: "getTests",
    value: function getTests() {
      return this.tests;
    }
  }, {
    key: "add",
    value: function add(test) {
      this.tests.push(test);
    }
  }]);

  return Suite;
}();

exports.default = Suite;

},{}],17:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var TestCase = function () {
  function TestCase(suite, name, fn) {
    _classCallCheck(this, TestCase);

    this.suite = suite;
    this.settings = this.suite.settings;
    this.name = name;
    this.fn = fn;
    this.progress = 0;
    this.status = 'waiting';
  }

  _createClass(TestCase, [{
    key: 'setProgress',
    value: function setProgress(value) {
      this.progress = value;
      this.updateCallback(this.suite.name, this.name, value);
    }
  }, {
    key: 'run',
    value: function run(updateCallback, resultCallback, doneCallback) {
      this.fn(this);
      this.updateCallback = updateCallback;
      this.resultCallback = resultCallback;
      this.doneCallback = doneCallback;
      this.setProgress(0);
    }
  }, {
    key: 'reportInfo',
    value: function reportInfo(m) {
      console.info('[' + this.suite.name + ' - ' + this.name + '] ' + m);
    }
  }, {
    key: 'reportSuccess',
    value: function reportSuccess(m) {
      console.info('[' + this.suite.name + ' - ' + this.name + '] ' + m);
      this.status = 'success';
    }
  }, {
    key: 'reportError',
    value: function reportError(m) {
      console.error('[' + this.suite.name + ' - ' + this.name + '] ' + m);
      this.status = 'error';
    }
  }, {
    key: 'reportWarning',
    value: function reportWarning(m) {
      console.warn('[' + this.suite.name + ' - ' + this.name + '] ' + m);
      this.status = 'warning';
    }
  }, {
    key: 'reportFatal',
    value: function reportFatal(m) {
      console.error('[' + this.suite.name + ' - ' + this.name + '] ' + m);
      this.status = 'error';
    }
  }, {
    key: 'done',
    value: function done() {
      if (this.progress !== 100) this.setProgress(100);
      this.resultCallback(this.suite.name, this.name, this.status);
      this.doneCallback();
    }
  }, {
    key: 'doGetUserMedia',
    value: function doGetUserMedia(constraints, onSuccess, onFail) {
      var self = this;
      try {
        // Call into getUserMedia via the polyfill (adapter.js).
        navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
          var cam = self.getDeviceName_(stream.getVideoTracks());
          var mic = self.getDeviceName_(stream.getAudioTracks());
          onSuccess.apply(this, arguments);
        }).catch(function (error) {
          if (onFail) {
            onFail.apply(this, arguments);
          } else {
            self.reportFatal('Failed to get access to local media due to ' + 'error: ' + error.name);
          }
        });
      } catch (e) {
        return this.reportFatal('getUserMedia failed with exception: ' + e.message);
      }
    }
  }, {
    key: 'setTimeoutWithProgressBar',
    value: function setTimeoutWithProgressBar(timeoutCallback, timeoutMs) {
      var start = window.performance.now();
      var self = this;
      var updateProgressBar = setInterval(function () {
        var now = window.performance.now();
        self.setProgress((now - start) * 100 / timeoutMs);
      }, 100);
      var timeoutTask = function timeoutTask() {
        clearInterval(updateProgressBar);
        self.setProgress(100);
        timeoutCallback();
      };
      var timer = setTimeout(timeoutTask, timeoutMs);
      var finishProgressBar = function finishProgressBar() {
        clearTimeout(timer);
        timeoutTask();
      };
      return finishProgressBar;
    }
  }, {
    key: 'getDeviceName_',
    value: function getDeviceName_(tracks) {
      if (tracks.length === 0) {
        return null;
      }
      return tracks[0].label;
    }
  }]);

  return TestCase;
}();

exports.default = TestCase;

},{}],18:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _config = require('./config');

var Config = _interopRequireWildcard(_config);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

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

var TestRTC = function () {
  function TestRTC() {
    var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, TestRTC);

    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;

    this.suites = [];

    var micSuite = Config.buildMicroSuite(this.config);
    var cameraSuite = Config.buildCameraSuite(this.config);
    var networkSuite = Config.buildNetworkSuite(this.config);
    var connectivitySuite = Config.buildConnectivitySuite(this.config);
    var throughputSuite = Config.buildThroughputSuite(this.config);

    this.suites.push(micSuite);
    this.suites.push(cameraSuite);
    this.suites.push(networkSuite);
    this.suites.push(connectivitySuite);
    this.suites.push(throughputSuite);
  }

  _createClass(TestRTC, [{
    key: 'getSuites',
    value: function getSuites() {
      return this.suites;
    }
  }, {
    key: 'getTests',
    value: function getTests() {
      return this.suites.reduce(function (all, suite) {
        return all.concat(suite.getTests());
      }, []);
    }
  }, {
    key: 'start',
    value: function start() {
      var onTestProgress = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};
      var onTestResult = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};
      var onComplete = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {};

      var allTests = this.getTests();
      runAllSequentially(allTests, onTestProgress, onTestResult, onComplete);
    }
  }]);

  return TestRTC;
}();

window.TestRTC = TestRTC;
exports.default = TestRTC;

},{"./config":15}],19:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _VideoFrameChecker = require('../util/VideoFrameChecker.js');

var _VideoFrameChecker2 = _interopRequireDefault(_VideoFrameChecker);

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();
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
        console.error(error);
        console.dir(constraints);
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
    var frameChecker = new _VideoFrameChecker2.default(video);
    var call = new _Call2.default(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    this.test.setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
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
    statsReport.avgEncodeTimeMs = (0, _util.arrayAverage)(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = (0, _util.arrayMin)(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = (0, _util.arrayMax)(googAvgEncodeTime);
    statsReport.avgInputFps = (0, _util.arrayAverage)(googAvgFrameRateInput);
    statsReport.minInputFps = (0, _util.arrayMin)(googAvgFrameRateInput);
    statsReport.maxInputFps = (0, _util.arrayMax)(googAvgFrameRateInput);
    statsReport.avgSentFps = (0, _util.arrayAverage)(googAvgFrameRateSent);
    statsReport.minSentFps = (0, _util.arrayMin)(googAvgFrameRateSent);
    statsReport.maxSentFps = (0, _util.arrayMax)(googAvgFrameRateSent);
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

},{"../util/Call.js":27,"../util/VideoFrameChecker.js":28,"../util/report.js":30,"../util/util.js":33}],20:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _VideoFrameChecker = require('../util/VideoFrameChecker.js');

var _VideoFrameChecker2 = _interopRequireDefault(_VideoFrameChecker);

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();
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
        console.error(error);
        console.dir(constraints);
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
    var frameChecker = new _VideoFrameChecker2.default(video);
    var call = new _Call2.default(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    this.test.setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
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
    statsReport.avgEncodeTimeMs = (0, _util.arrayAverage)(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = (0, _util.arrayMin)(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = (0, _util.arrayMax)(googAvgEncodeTime);
    statsReport.avgInputFps = (0, _util.arrayAverage)(googAvgFrameRateInput);
    statsReport.minInputFps = (0, _util.arrayMin)(googAvgFrameRateInput);
    statsReport.maxInputFps = (0, _util.arrayMax)(googAvgFrameRateInput);
    statsReport.avgSentFps = (0, _util.arrayAverage)(googAvgFrameRateSent);
    statsReport.minSentFps = (0, _util.arrayMin)(googAvgFrameRateSent);
    statsReport.maxSentFps = (0, _util.arrayMax)(googAvgFrameRateSent);
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

},{"../util/Call.js":27,"../util/VideoFrameChecker.js":28,"../util/report.js":30,"../util/util.js":33}],21:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function RunConnectivityTest(test, iceCandidateFilter) {
  this.test = test;
  this.iceCandidateFilter = iceCandidateFilter;
  this.timeout = null;
  this.parsedCandidates = [];
  this.call = null;
}

RunConnectivityTest.prototype = {
  run: function run() {
    _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _Call2.default(config, this.test);
    this.call.setIceCandidateFilter(this.iceCandidateFilter);

    // Collect all candidates for validation.
    this.call.pc1.addEventListener('icecandidate', function (event) {
      if (event.candidate) {
        var parsedCandidate = _Call2.default.parseCandidate(event.candidate.candidate);
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
      if (errorMessage === 'Timed out' && this.iceCandidateFilter.toString() === _Call2.default.isReflexive.toString() && this.findParsedCandidateOfSpecifiedType(_Call2.default.isReflexive)) {
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

},{"../util/Call.js":27}],22:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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
    _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _Call2.default(config, this.test);
    this.call.setIceCandidateFilter(_Call2.default.isRelay);
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

},{"../util/Call.js":27}],23:[function(require,module,exports){
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
  try {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext();
  } catch (e) {
    console.error('Failed to instantiate an audio context, error: ' + e);
  }
}

MicTest.prototype = {
  run: function run() {
    if (typeof this.audioContext === 'undefined') {
      this.test.reportError('WebAudio is not supported, test cannot run.');
      this.test.done();
    } else {
      this.test.doGetUserMedia(this.constraints, this.gotStream.bind(this));
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
    this.audioSource = this.audioContext.createMediaStreamSource(this.stream);
    this.scriptNode = this.audioContext.createScriptProcessor(this.bufferSize, this.inputChannelCount, this.outputChannelCount);
    this.audioSource.connect(this.scriptNode);
    this.scriptNode.connect(this.audioContext.destination);
    this.scriptNode.onaudioprocess = this.collectAudio.bind(this);
    this.stopCollectingAudio = this.test.setTimeoutWithProgressBar(this.onStopCollectingAudio.bind(this), 5000);
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
    this.scriptNode.disconnect(this.audioContext.destination);
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

},{}],24:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var NetworkTest = function NetworkTest(test, protocol, params, iceCandidateFilter) {
  this.test = test;
  this.protocol = protocol;
  this.params = params;
  this.iceCandidateFilter = iceCandidateFilter;
};

NetworkTest.prototype = {
  run: function run() {
    // Do not create turn config for IPV6 test.
    if (this.iceCandidateFilter.toString() === _Call2.default.isIpv6.toString()) {
      this.gatherCandidates(null, this.params, this.iceCandidateFilter);
    } else {
      _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
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
        var parsed = _Call2.default.parseCandidate(e.candidate.candidate);
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

},{"../util/Call.js":27}],25:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _stats = require('../util/stats.js');

var _stats2 = _interopRequireDefault(_stats);

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function VideoBandwidthTest(test) {
  this.test = test;
  this.maxVideoBitrateKbps = 2000;
  this.durationMs = 40000;
  this.statStepMs = 100;
  this.bweStats = new _stats2.default(0.75 * this.maxVideoBitrateKbps * 1000);
  this.rttStats = new _stats2.default();
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
    _call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _call2.default(config, this.test);
    this.call.setIceCandidateFilter(_call2.default.isRelay);
    // FEC makes it hard to study bandwidth estimation since there seems to be
    // a spike when it is enabled and disabled. Disable it for now. FEC issue
    // tracked on: https://code.google.com/p/webrtc/issues/detail?id=3050
    this.call.disableVideoFec();
    this.call.constrainVideoBitrate(this.maxVideoBitrateKbps);
    this.test.doGetUserMedia(this.constraints, this.gotStream.bind(this));
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
    if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
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
    } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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
    if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
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
    } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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

},{"../util/call.js":29,"../util/stats.js":32,"webrtc-adapter":3}],26:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

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
    _call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.running = true;
    this.call = new _call2.default(config, this.test);
    this.call.setIceCandidateFilter(this.candidateFilter);

    this.senderChannel = this.call.pc1.createDataChannel({ ordered: false,
      maxRetransmits: 0 });
    this.senderChannel.addEventListener('open', this.send.bind(this));
    this.call.pc2.addEventListener('datachannel', this.onReceiverChannel.bind(this));
    this.call.establishConnection();

    this.test.setTimeoutWithProgressBar(this.finishTest.bind(this), this.testDurationMs);
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
  },

  finishTest: function finishTest() {
    report.traceEventInstant('periodic-delay', { delays: this.delays,
      recvTimeStamps: this.recvTimeStamps });
    this.running = false;
    this.call.close();
    this.call = null;

    var avg = (0, _util.arrayAverage)(this.delays);
    var max = (0, _util.arrayMax)(this.delays);
    var min = (0, _util.arrayMin)(this.delays);
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

},{"../util/call.js":29,"../util/report.js":30,"../util/util.js":33}],27:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _report = require('./report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('./util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

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
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats2.push(enumeratedStats);
        statsCollectTime2.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats.push(enumeratedStats);
        statsCollectTime.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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
Call.asyncCreateTurnConfig = function (onSuccess, onError, currentTest) {
  var settings = currentTest.settings;
  var iceServer = {
    'username': settings.turnUsername || '',
    'credential': settings.turnCredential || '',
    'urls': settings.turnURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('turn-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

// Get a STUN config, either from settings or from network traversal server.
Call.asyncCreateStunConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  var iceServer = {
    'urls': settings.stunURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('stun-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

exports.default = Call;

},{"./report.js":30,"./util.js":33,"webrtc-adapter":3}],28:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _ssim = require('./ssim.js');

var _ssim2 = _interopRequireDefault(_ssim);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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
  this.frameComparator = new _ssim2.default();

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

},{"./ssim.js":31}],29:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _report = require('./report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('./util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

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
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats2.push(enumeratedStats);
        statsCollectTime2.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats.push(enumeratedStats);
        statsCollectTime.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
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
Call.asyncCreateTurnConfig = function (onSuccess, onError, currentTest) {
  var settings = currentTest.settings;
  var iceServer = {
    'username': settings.turnUsername || '',
    'credential': settings.turnCredential || '',
    'urls': settings.turnURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('turn-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

// Get a STUN config, either from settings or from network traversal server.
Call.asyncCreateStunConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  var iceServer = {
    'urls': settings.stunURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('stun-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

exports.default = Call;

},{"./report.js":30,"./util.js":33,"webrtc-adapter":3}],30:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* exported report */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
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

exports.default = Report;

},{}],31:[function(require,module,exports){
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

},{}],32:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
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

exports.default = StatisticsAggregate;

},{}],33:[function(require,module,exports){
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

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.arrayAverage = arrayAverage;
exports.arrayMax = arrayMax;
exports.arrayMin = arrayMin;
exports.enumerateStats = enumerateStats;
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

},{}],34:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _ssim = require('./ssim.js');

var _ssim2 = _interopRequireDefault(_ssim);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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
  this.frameComparator = new _ssim2.default();

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

},{"./ssim.js":31}]},{},[15,16,17,18,19,21,22,23,24,25,26,29,30,31,32,33,34])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvcnRjcGVlcmNvbm5lY3Rpb24tc2hpbS9ydGNwZWVyY29ubmVjdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9zZHAvc2RwLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9hZGFwdGVyX2NvcmUuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2FkYXB0ZXJfZmFjdG9yeS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvY2hyb21lL2Nocm9tZV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jaHJvbWUvZ2V0dXNlcm1lZGlhLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jb21tb25fc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9lZGdlX3NoaW0uanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2VkZ2UvZmlsdGVyaWNlc2VydmVycy5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9nZXR1c2VybWVkaWEuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2ZpcmVmb3gvZmlyZWZveF9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9maXJlZm94L2dldHVzZXJtZWRpYS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvc2FmYXJpL3NhZmFyaV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy91dGlscy5qcyIsInNyYy9jb25maWcvaW5kZXguanMiLCJzcmMvY29uZmlnL3N1aXRlLmpzIiwic3JjL2NvbmZpZy90ZXN0Q2FzZS5qcyIsInNyYy9pbmRleC5qcyIsInNyYy91bml0L2NhbVJlc29sdXRpb25zLmpzIiwic3JjL3VuaXQvY2FtcmVzb2x1dGlvbnMuanMiLCJzcmMvdW5pdC9jb25uLmpzIiwic3JjL3VuaXQvZGF0YUJhbmR3aWR0aC5qcyIsInNyYy91bml0L21pYy5qcyIsInNyYy91bml0L25ldC5qcyIsInNyYy91bml0L3ZpZGVvQmFuZHdpZHRoLmpzIiwic3JjL3VuaXQvd2lmaVBlcmlvZGljU2Nhbi5qcyIsInNyYy91dGlsL0NhbGwuanMiLCJzcmMvdXRpbC9WaWRlb0ZyYW1lQ2hlY2tlci5qcyIsInNyYy91dGlsL2NhbGwuanMiLCJzcmMvdXRpbC9yZXBvcnQuanMiLCJzcmMvdXRpbC9zc2ltLmpzIiwic3JjL3V0aWwvc3RhdHMuanMiLCJzcmMvdXRpbC91dGlsLmpzIiwic3JjL3V0aWwvdmlkZW9mcmFtZWNoZWNrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0eURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDM3FCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0NEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9SQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDak5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hMQTs7Ozs7O1FBd0NnQixlLEdBQUEsZTtRQVNBLGdCLEdBQUEsZ0I7UUEwQkEsaUIsR0FBQSxpQjtRQXdCQSxzQixHQUFBLHNCO1FBMEJBLG9CLEdBQUEsb0I7O0FBM0hoQjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7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dUJBQVMsSUFBVCxFQUFlLE1BQWYsRUFBdUI7QUFDcEM7QUFDQSxRQUFJLFNBQVMsS0FBSywwQkFBbEI7QUFDQSxRQUFJLFdBQVcsQ0FBZjtBQUNBLFNBQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxNQUFwQixFQUE0QixLQUFLLENBQWpDLEVBQW9DO0FBQ2xDO0FBQ0Esa0JBQVksT0FBTyxLQUFLLENBQUwsQ0FBUCxHQUFpQixPQUFPLEtBQUssSUFBSSxDQUFULENBQXhCLEdBQXNDLE9BQU8sS0FBSyxJQUFJLENBQVQsQ0FBekQ7QUFDQTtBQUNBLFVBQUksV0FBWSxTQUFTLENBQVQsR0FBYSxDQUE3QixFQUFpQztBQUMvQixlQUFPLEtBQVA7QUFDRDtBQUNGO0FBQ0QsV0FBTyxJQUFQO0FBQ0Q7QUFyRDJCLENBQTlCOztBQXdEQSxJQUFJLFFBQU8sT0FBUCx5Q0FBTyxPQUFQLE9BQW1CLFFBQXZCLEVBQWlDO0FBQy9CLFNBQU8sT0FBUCxHQUFpQixpQkFBakI7QUFDRCIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE3IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgU0RQVXRpbHMgPSByZXF1aXJlKCdzZHAnKTtcblxuZnVuY3Rpb24gZml4U3RhdHNUeXBlKHN0YXQpIHtcbiAgcmV0dXJuIHtcbiAgICBpbmJvdW5kcnRwOiAnaW5ib3VuZC1ydHAnLFxuICAgIG91dGJvdW5kcnRwOiAnb3V0Ym91bmQtcnRwJyxcbiAgICBjYW5kaWRhdGVwYWlyOiAnY2FuZGlkYXRlLXBhaXInLFxuICAgIGxvY2FsY2FuZGlkYXRlOiAnbG9jYWwtY2FuZGlkYXRlJyxcbiAgICByZW1vdGVjYW5kaWRhdGU6ICdyZW1vdGUtY2FuZGlkYXRlJ1xuICB9W3N0YXQudHlwZV0gfHwgc3RhdC50eXBlO1xufVxuXG5mdW5jdGlvbiB3cml0ZU1lZGlhU2VjdGlvbih0cmFuc2NlaXZlciwgY2FwcywgdHlwZSwgc3RyZWFtLCBkdGxzUm9sZSkge1xuICB2YXIgc2RwID0gU0RQVXRpbHMud3JpdGVSdHBEZXNjcmlwdGlvbih0cmFuc2NlaXZlci5raW5kLCBjYXBzKTtcblxuICAvLyBNYXAgSUNFIHBhcmFtZXRlcnMgKHVmcmFnLCBwd2QpIHRvIFNEUC5cbiAgc2RwICs9IFNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyhcbiAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLmdldExvY2FsUGFyYW1ldGVycygpKTtcblxuICAvLyBNYXAgRFRMUyBwYXJhbWV0ZXJzIHRvIFNEUC5cbiAgc2RwICs9IFNEUFV0aWxzLndyaXRlRHRsc1BhcmFtZXRlcnMoXG4gICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LmdldExvY2FsUGFyYW1ldGVycygpLFxuICAgICAgdHlwZSA9PT0gJ29mZmVyJyA/ICdhY3RwYXNzJyA6IGR0bHNSb2xlIHx8ICdhY3RpdmUnKTtcblxuICBzZHAgKz0gJ2E9bWlkOicgKyB0cmFuc2NlaXZlci5taWQgKyAnXFxyXFxuJztcblxuICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyICYmIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyKSB7XG4gICAgc2RwICs9ICdhPXNlbmRyZWN2XFxyXFxuJztcbiAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICBzZHAgKz0gJ2E9c2VuZG9ubHlcXHJcXG4nO1xuICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyKSB7XG4gICAgc2RwICs9ICdhPXJlY3Zvbmx5XFxyXFxuJztcbiAgfSBlbHNlIHtcbiAgICBzZHAgKz0gJ2E9aW5hY3RpdmVcXHJcXG4nO1xuICB9XG5cbiAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgIHZhciB0cmFja0lkID0gdHJhbnNjZWl2ZXIucnRwU2VuZGVyLl9pbml0aWFsVHJhY2tJZCB8fFxuICAgICAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIudHJhY2suaWQ7XG4gICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLl9pbml0aWFsVHJhY2tJZCA9IHRyYWNrSWQ7XG4gICAgLy8gc3BlYy5cbiAgICB2YXIgbXNpZCA9ICdtc2lkOicgKyAoc3RyZWFtID8gc3RyZWFtLmlkIDogJy0nKSArICcgJyArXG4gICAgICAgIHRyYWNrSWQgKyAnXFxyXFxuJztcbiAgICBzZHAgKz0gJ2E9JyArIG1zaWQ7XG4gICAgLy8gZm9yIENocm9tZS4gTGVnYWN5IHNob3VsZCBubyBsb25nZXIgYmUgcmVxdWlyZWQuXG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArXG4gICAgICAgICcgJyArIG1zaWQ7XG5cbiAgICAvLyBSVFhcbiAgICBpZiAodHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgICAnICcgKyBtc2lkO1xuICAgICAgc2RwICs9ICdhPXNzcmMtZ3JvdXA6RklEICcgK1xuICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArICcgJyArXG4gICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICAgJ1xcclxcbic7XG4gICAgfVxuICB9XG4gIC8vIEZJWE1FOiB0aGlzIHNob3VsZCBiZSB3cml0dGVuIGJ5IHdyaXRlUnRwRGVzY3JpcHRpb24uXG4gIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgK1xuICAgICAgJyBjbmFtZTonICsgU0RQVXRpbHMubG9jYWxDTmFtZSArICdcXHJcXG4nO1xuICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyICYmIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAnIGNuYW1lOicgKyBTRFBVdGlscy5sb2NhbENOYW1lICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn1cblxuLy8gRWRnZSBkb2VzIG5vdCBsaWtlXG4vLyAxKSBzdHVuOiBmaWx0ZXJlZCBhZnRlciAxNDM5MyB1bmxlc3MgP3RyYW5zcG9ydD11ZHAgaXMgcHJlc2VudFxuLy8gMikgdHVybjogdGhhdCBkb2VzIG5vdCBoYXZlIGFsbCBvZiB0dXJuOmhvc3Q6cG9ydD90cmFuc3BvcnQ9dWRwXG4vLyAzKSB0dXJuOiB3aXRoIGlwdjYgYWRkcmVzc2VzXG4vLyA0KSB0dXJuOiBvY2N1cnJpbmcgbXVsaXBsZSB0aW1lc1xuZnVuY3Rpb24gZmlsdGVySWNlU2VydmVycyhpY2VTZXJ2ZXJzLCBlZGdlVmVyc2lvbikge1xuICB2YXIgaGFzVHVybiA9IGZhbHNlO1xuICBpY2VTZXJ2ZXJzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShpY2VTZXJ2ZXJzKSk7XG4gIHJldHVybiBpY2VTZXJ2ZXJzLmZpbHRlcihmdW5jdGlvbihzZXJ2ZXIpIHtcbiAgICBpZiAoc2VydmVyICYmIChzZXJ2ZXIudXJscyB8fCBzZXJ2ZXIudXJsKSkge1xuICAgICAgdmFyIHVybHMgPSBzZXJ2ZXIudXJscyB8fCBzZXJ2ZXIudXJsO1xuICAgICAgaWYgKHNlcnZlci51cmwgJiYgIXNlcnZlci51cmxzKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignUlRDSWNlU2VydmVyLnVybCBpcyBkZXByZWNhdGVkISBVc2UgdXJscyBpbnN0ZWFkLicpO1xuICAgICAgfVxuICAgICAgdmFyIGlzU3RyaW5nID0gdHlwZW9mIHVybHMgPT09ICdzdHJpbmcnO1xuICAgICAgaWYgKGlzU3RyaW5nKSB7XG4gICAgICAgIHVybHMgPSBbdXJsc107XG4gICAgICB9XG4gICAgICB1cmxzID0gdXJscy5maWx0ZXIoZnVuY3Rpb24odXJsKSB7XG4gICAgICAgIHZhciB2YWxpZFR1cm4gPSB1cmwuaW5kZXhPZigndHVybjonKSA9PT0gMCAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJ3RyYW5zcG9ydD11ZHAnKSAhPT0gLTEgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCd0dXJuOlsnKSA9PT0gLTEgJiZcbiAgICAgICAgICAgICFoYXNUdXJuO1xuXG4gICAgICAgIGlmICh2YWxpZFR1cm4pIHtcbiAgICAgICAgICBoYXNUdXJuID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXJsLmluZGV4T2YoJ3N0dW46JykgPT09IDAgJiYgZWRnZVZlcnNpb24gPj0gMTQzOTMgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCc/dHJhbnNwb3J0PXVkcCcpID09PSAtMTtcbiAgICAgIH0pO1xuXG4gICAgICBkZWxldGUgc2VydmVyLnVybDtcbiAgICAgIHNlcnZlci51cmxzID0gaXNTdHJpbmcgPyB1cmxzWzBdIDogdXJscztcbiAgICAgIHJldHVybiAhIXVybHMubGVuZ3RoO1xuICAgIH1cbiAgfSk7XG59XG5cbi8vIERldGVybWluZXMgdGhlIGludGVyc2VjdGlvbiBvZiBsb2NhbCBhbmQgcmVtb3RlIGNhcGFiaWxpdGllcy5cbmZ1bmN0aW9uIGdldENvbW1vbkNhcGFiaWxpdGllcyhsb2NhbENhcGFiaWxpdGllcywgcmVtb3RlQ2FwYWJpbGl0aWVzKSB7XG4gIHZhciBjb21tb25DYXBhYmlsaXRpZXMgPSB7XG4gICAgY29kZWNzOiBbXSxcbiAgICBoZWFkZXJFeHRlbnNpb25zOiBbXSxcbiAgICBmZWNNZWNoYW5pc21zOiBbXVxuICB9O1xuXG4gIHZhciBmaW5kQ29kZWNCeVBheWxvYWRUeXBlID0gZnVuY3Rpb24ocHQsIGNvZGVjcykge1xuICAgIHB0ID0gcGFyc2VJbnQocHQsIDEwKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvZGVjcy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGNvZGVjc1tpXS5wYXlsb2FkVHlwZSA9PT0gcHQgfHxcbiAgICAgICAgICBjb2RlY3NbaV0ucHJlZmVycmVkUGF5bG9hZFR5cGUgPT09IHB0KSB7XG4gICAgICAgIHJldHVybiBjb2RlY3NbaV07XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIHZhciBydHhDYXBhYmlsaXR5TWF0Y2hlcyA9IGZ1bmN0aW9uKGxSdHgsIHJSdHgsIGxDb2RlY3MsIHJDb2RlY3MpIHtcbiAgICB2YXIgbENvZGVjID0gZmluZENvZGVjQnlQYXlsb2FkVHlwZShsUnR4LnBhcmFtZXRlcnMuYXB0LCBsQ29kZWNzKTtcbiAgICB2YXIgckNvZGVjID0gZmluZENvZGVjQnlQYXlsb2FkVHlwZShyUnR4LnBhcmFtZXRlcnMuYXB0LCByQ29kZWNzKTtcbiAgICByZXR1cm4gbENvZGVjICYmIHJDb2RlYyAmJlxuICAgICAgICBsQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpID09PSByQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpO1xuICB9O1xuXG4gIGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKGxDb2RlYykge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVtb3RlQ2FwYWJpbGl0aWVzLmNvZGVjcy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHJDb2RlYyA9IHJlbW90ZUNhcGFiaWxpdGllcy5jb2RlY3NbaV07XG4gICAgICBpZiAobENvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gckNvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSAmJlxuICAgICAgICAgIGxDb2RlYy5jbG9ja1JhdGUgPT09IHJDb2RlYy5jbG9ja1JhdGUpIHtcbiAgICAgICAgaWYgKGxDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgPT09ICdydHgnICYmXG4gICAgICAgICAgICBsQ29kZWMucGFyYW1ldGVycyAmJiByQ29kZWMucGFyYW1ldGVycy5hcHQpIHtcbiAgICAgICAgICAvLyBmb3IgUlRYIHdlIG5lZWQgdG8gZmluZCB0aGUgbG9jYWwgcnR4IHRoYXQgaGFzIGEgYXB0XG4gICAgICAgICAgLy8gd2hpY2ggcG9pbnRzIHRvIHRoZSBzYW1lIGxvY2FsIGNvZGVjIGFzIHRoZSByZW1vdGUgb25lLlxuICAgICAgICAgIGlmICghcnR4Q2FwYWJpbGl0eU1hdGNoZXMobENvZGVjLCByQ29kZWMsXG4gICAgICAgICAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcywgcmVtb3RlQ2FwYWJpbGl0aWVzLmNvZGVjcykpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByQ29kZWMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJDb2RlYykpOyAvLyBkZWVwY29weVxuICAgICAgICAvLyBudW1iZXIgb2YgY2hhbm5lbHMgaXMgdGhlIGhpZ2hlc3QgY29tbW9uIG51bWJlciBvZiBjaGFubmVsc1xuICAgICAgICByQ29kZWMubnVtQ2hhbm5lbHMgPSBNYXRoLm1pbihsQ29kZWMubnVtQ2hhbm5lbHMsXG4gICAgICAgICAgICByQ29kZWMubnVtQ2hhbm5lbHMpO1xuICAgICAgICAvLyBwdXNoIHJDb2RlYyBzbyB3ZSByZXBseSB3aXRoIG9mZmVyZXIgcGF5bG9hZCB0eXBlXG4gICAgICAgIGNvbW1vbkNhcGFiaWxpdGllcy5jb2RlY3MucHVzaChyQ29kZWMpO1xuXG4gICAgICAgIC8vIGRldGVybWluZSBjb21tb24gZmVlZGJhY2sgbWVjaGFuaXNtc1xuICAgICAgICByQ29kZWMucnRjcEZlZWRiYWNrID0gckNvZGVjLnJ0Y3BGZWVkYmFjay5maWx0ZXIoZnVuY3Rpb24oZmIpIHtcbiAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGxDb2RlYy5ydGNwRmVlZGJhY2subGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIGlmIChsQ29kZWMucnRjcEZlZWRiYWNrW2pdLnR5cGUgPT09IGZiLnR5cGUgJiZcbiAgICAgICAgICAgICAgICBsQ29kZWMucnRjcEZlZWRiYWNrW2pdLnBhcmFtZXRlciA9PT0gZmIucGFyYW1ldGVyKSB7XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0pO1xuICAgICAgICAvLyBGSVhNRTogYWxzbyBuZWVkIHRvIGRldGVybWluZSAucGFyYW1ldGVyc1xuICAgICAgICAvLyAgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9vcGVucGVlci9vcnRjL2lzc3Vlcy81NjlcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICBsb2NhbENhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZnVuY3Rpb24obEhlYWRlckV4dGVuc2lvbikge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVtb3RlQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnMubGVuZ3RoO1xuICAgICAgICAgaSsrKSB7XG4gICAgICB2YXIgckhlYWRlckV4dGVuc2lvbiA9IHJlbW90ZUNhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zW2ldO1xuICAgICAgaWYgKGxIZWFkZXJFeHRlbnNpb24udXJpID09PSBySGVhZGVyRXh0ZW5zaW9uLnVyaSkge1xuICAgICAgICBjb21tb25DYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9ucy5wdXNoKHJIZWFkZXJFeHRlbnNpb24pO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8vIEZJWE1FOiBmZWNNZWNoYW5pc21zXG4gIHJldHVybiBjb21tb25DYXBhYmlsaXRpZXM7XG59XG5cbi8vIGlzIGFjdGlvbj1zZXRMb2NhbERlc2NyaXB0aW9uIHdpdGggdHlwZSBhbGxvd2VkIGluIHNpZ25hbGluZ1N0YXRlXG5mdW5jdGlvbiBpc0FjdGlvbkFsbG93ZWRJblNpZ25hbGluZ1N0YXRlKGFjdGlvbiwgdHlwZSwgc2lnbmFsaW5nU3RhdGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvZmZlcjoge1xuICAgICAgc2V0TG9jYWxEZXNjcmlwdGlvbjogWydzdGFibGUnLCAnaGF2ZS1sb2NhbC1vZmZlciddLFxuICAgICAgc2V0UmVtb3RlRGVzY3JpcHRpb246IFsnc3RhYmxlJywgJ2hhdmUtcmVtb3RlLW9mZmVyJ11cbiAgICB9LFxuICAgIGFuc3dlcjoge1xuICAgICAgc2V0TG9jYWxEZXNjcmlwdGlvbjogWydoYXZlLXJlbW90ZS1vZmZlcicsICdoYXZlLWxvY2FsLXByYW5zd2VyJ10sXG4gICAgICBzZXRSZW1vdGVEZXNjcmlwdGlvbjogWydoYXZlLWxvY2FsLW9mZmVyJywgJ2hhdmUtcmVtb3RlLXByYW5zd2VyJ11cbiAgICB9XG4gIH1bdHlwZV1bYWN0aW9uXS5pbmRleE9mKHNpZ25hbGluZ1N0YXRlKSAhPT0gLTE7XG59XG5cbmZ1bmN0aW9uIG1heWJlQWRkQ2FuZGlkYXRlKGljZVRyYW5zcG9ydCwgY2FuZGlkYXRlKSB7XG4gIC8vIEVkZ2UncyBpbnRlcm5hbCByZXByZXNlbnRhdGlvbiBhZGRzIHNvbWUgZmllbGRzIHRoZXJlZm9yZVxuICAvLyBub3QgYWxsIGZpZWxk0ZUgYXJlIHRha2VuIGludG8gYWNjb3VudC5cbiAgdmFyIGFscmVhZHlBZGRlZCA9IGljZVRyYW5zcG9ydC5nZXRSZW1vdGVDYW5kaWRhdGVzKClcbiAgICAgIC5maW5kKGZ1bmN0aW9uKHJlbW90ZUNhbmRpZGF0ZSkge1xuICAgICAgICByZXR1cm4gY2FuZGlkYXRlLmZvdW5kYXRpb24gPT09IHJlbW90ZUNhbmRpZGF0ZS5mb3VuZGF0aW9uICYmXG4gICAgICAgICAgICBjYW5kaWRhdGUuaXAgPT09IHJlbW90ZUNhbmRpZGF0ZS5pcCAmJlxuICAgICAgICAgICAgY2FuZGlkYXRlLnBvcnQgPT09IHJlbW90ZUNhbmRpZGF0ZS5wb3J0ICYmXG4gICAgICAgICAgICBjYW5kaWRhdGUucHJpb3JpdHkgPT09IHJlbW90ZUNhbmRpZGF0ZS5wcmlvcml0eSAmJlxuICAgICAgICAgICAgY2FuZGlkYXRlLnByb3RvY29sID09PSByZW1vdGVDYW5kaWRhdGUucHJvdG9jb2wgJiZcbiAgICAgICAgICAgIGNhbmRpZGF0ZS50eXBlID09PSByZW1vdGVDYW5kaWRhdGUudHlwZTtcbiAgICAgIH0pO1xuICBpZiAoIWFscmVhZHlBZGRlZCkge1xuICAgIGljZVRyYW5zcG9ydC5hZGRSZW1vdGVDYW5kaWRhdGUoY2FuZGlkYXRlKTtcbiAgfVxuICByZXR1cm4gIWFscmVhZHlBZGRlZDtcbn1cblxuXG5mdW5jdGlvbiBtYWtlRXJyb3IobmFtZSwgZGVzY3JpcHRpb24pIHtcbiAgdmFyIGUgPSBuZXcgRXJyb3IoZGVzY3JpcHRpb24pO1xuICBlLm5hbWUgPSBuYW1lO1xuICAvLyBsZWdhY3kgZXJyb3IgY29kZXMgZnJvbSBodHRwczovL2hleWNhbS5naXRodWIuaW8vd2ViaWRsLyNpZGwtRE9NRXhjZXB0aW9uLWVycm9yLW5hbWVzXG4gIGUuY29kZSA9IHtcbiAgICBOb3RTdXBwb3J0ZWRFcnJvcjogOSxcbiAgICBJbnZhbGlkU3RhdGVFcnJvcjogMTEsXG4gICAgSW52YWxpZEFjY2Vzc0Vycm9yOiAxNSxcbiAgICBUeXBlRXJyb3I6IHVuZGVmaW5lZCxcbiAgICBPcGVyYXRpb25FcnJvcjogdW5kZWZpbmVkXG4gIH1bbmFtZV07XG4gIHJldHVybiBlO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHdpbmRvdywgZWRnZVZlcnNpb24pIHtcbiAgLy8gaHR0cHM6Ly93M2MuZ2l0aHViLmlvL21lZGlhY2FwdHVyZS1tYWluLyNtZWRpYXN0cmVhbVxuICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gYWRkIHRoZSB0cmFjayB0byB0aGUgc3RyZWFtIGFuZFxuICAvLyBkaXNwYXRjaCB0aGUgZXZlbnQgb3Vyc2VsdmVzLlxuICBmdW5jdGlvbiBhZGRUcmFja1RvU3RyZWFtQW5kRmlyZUV2ZW50KHRyYWNrLCBzdHJlYW0pIHtcbiAgICBzdHJlYW0uYWRkVHJhY2sodHJhY2spO1xuICAgIHN0cmVhbS5kaXNwYXRjaEV2ZW50KG5ldyB3aW5kb3cuTWVkaWFTdHJlYW1UcmFja0V2ZW50KCdhZGR0cmFjaycsXG4gICAgICAgIHt0cmFjazogdHJhY2t9KSk7XG4gIH1cblxuICBmdW5jdGlvbiByZW1vdmVUcmFja0Zyb21TdHJlYW1BbmRGaXJlRXZlbnQodHJhY2ssIHN0cmVhbSkge1xuICAgIHN0cmVhbS5yZW1vdmVUcmFjayh0cmFjayk7XG4gICAgc3RyZWFtLmRpc3BhdGNoRXZlbnQobmV3IHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrRXZlbnQoJ3JlbW92ZXRyYWNrJyxcbiAgICAgICAge3RyYWNrOiB0cmFja30pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZpcmVBZGRUcmFjayhwYywgdHJhY2ssIHJlY2VpdmVyLCBzdHJlYW1zKSB7XG4gICAgdmFyIHRyYWNrRXZlbnQgPSBuZXcgRXZlbnQoJ3RyYWNrJyk7XG4gICAgdHJhY2tFdmVudC50cmFjayA9IHRyYWNrO1xuICAgIHRyYWNrRXZlbnQucmVjZWl2ZXIgPSByZWNlaXZlcjtcbiAgICB0cmFja0V2ZW50LnRyYW5zY2VpdmVyID0ge3JlY2VpdmVyOiByZWNlaXZlcn07XG4gICAgdHJhY2tFdmVudC5zdHJlYW1zID0gc3RyZWFtcztcbiAgICB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIHBjLl9kaXNwYXRjaEV2ZW50KCd0cmFjaycsIHRyYWNrRXZlbnQpO1xuICAgIH0pO1xuICB9XG5cbiAgdmFyIFJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdmFyIHBjID0gdGhpcztcblxuICAgIHZhciBfZXZlbnRUYXJnZXQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgWydhZGRFdmVudExpc3RlbmVyJywgJ3JlbW92ZUV2ZW50TGlzdGVuZXInLCAnZGlzcGF0Y2hFdmVudCddXG4gICAgICAgIC5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICAgIHBjW21ldGhvZF0gPSBfZXZlbnRUYXJnZXRbbWV0aG9kXS5iaW5kKF9ldmVudFRhcmdldCk7XG4gICAgICAgIH0pO1xuXG4gICAgdGhpcy5jYW5Ucmlja2xlSWNlQ2FuZGlkYXRlcyA9IG51bGw7XG5cbiAgICB0aGlzLm5lZWROZWdvdGlhdGlvbiA9IGZhbHNlO1xuXG4gICAgdGhpcy5sb2NhbFN0cmVhbXMgPSBbXTtcbiAgICB0aGlzLnJlbW90ZVN0cmVhbXMgPSBbXTtcblxuICAgIHRoaXMuX2xvY2FsRGVzY3JpcHRpb24gPSBudWxsO1xuICAgIHRoaXMuX3JlbW90ZURlc2NyaXB0aW9uID0gbnVsbDtcblxuICAgIHRoaXMuc2lnbmFsaW5nU3RhdGUgPSAnc3RhYmxlJztcbiAgICB0aGlzLmljZUNvbm5lY3Rpb25TdGF0ZSA9ICduZXcnO1xuICAgIHRoaXMuY29ubmVjdGlvblN0YXRlID0gJ25ldyc7XG4gICAgdGhpcy5pY2VHYXRoZXJpbmdTdGF0ZSA9ICduZXcnO1xuXG4gICAgY29uZmlnID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjb25maWcgfHwge30pKTtcblxuICAgIHRoaXMudXNpbmdCdW5kbGUgPSBjb25maWcuYnVuZGxlUG9saWN5ID09PSAnbWF4LWJ1bmRsZSc7XG4gICAgaWYgKGNvbmZpZy5ydGNwTXV4UG9saWN5ID09PSAnbmVnb3RpYXRlJykge1xuICAgICAgdGhyb3cobWFrZUVycm9yKCdOb3RTdXBwb3J0ZWRFcnJvcicsXG4gICAgICAgICAgJ3J0Y3BNdXhQb2xpY3kgXFwnbmVnb3RpYXRlXFwnIGlzIG5vdCBzdXBwb3J0ZWQnKSk7XG4gICAgfSBlbHNlIGlmICghY29uZmlnLnJ0Y3BNdXhQb2xpY3kpIHtcbiAgICAgIGNvbmZpZy5ydGNwTXV4UG9saWN5ID0gJ3JlcXVpcmUnO1xuICAgIH1cblxuICAgIHN3aXRjaCAoY29uZmlnLmljZVRyYW5zcG9ydFBvbGljeSkge1xuICAgICAgY2FzZSAnYWxsJzpcbiAgICAgIGNhc2UgJ3JlbGF5JzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBjb25maWcuaWNlVHJhbnNwb3J0UG9saWN5ID0gJ2FsbCc7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIHN3aXRjaCAoY29uZmlnLmJ1bmRsZVBvbGljeSkge1xuICAgICAgY2FzZSAnYmFsYW5jZWQnOlxuICAgICAgY2FzZSAnbWF4LWNvbXBhdCc6XG4gICAgICBjYXNlICdtYXgtYnVuZGxlJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBjb25maWcuYnVuZGxlUG9saWN5ID0gJ2JhbGFuY2VkJztcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgY29uZmlnLmljZVNlcnZlcnMgPSBmaWx0ZXJJY2VTZXJ2ZXJzKGNvbmZpZy5pY2VTZXJ2ZXJzIHx8IFtdLCBlZGdlVmVyc2lvbik7XG5cbiAgICB0aGlzLl9pY2VHYXRoZXJlcnMgPSBbXTtcbiAgICBpZiAoY29uZmlnLmljZUNhbmRpZGF0ZVBvb2xTaXplKSB7XG4gICAgICBmb3IgKHZhciBpID0gY29uZmlnLmljZUNhbmRpZGF0ZVBvb2xTaXplOyBpID4gMDsgaS0tKSB7XG4gICAgICAgIHRoaXMuX2ljZUdhdGhlcmVycy5wdXNoKG5ldyB3aW5kb3cuUlRDSWNlR2F0aGVyZXIoe1xuICAgICAgICAgIGljZVNlcnZlcnM6IGNvbmZpZy5pY2VTZXJ2ZXJzLFxuICAgICAgICAgIGdhdGhlclBvbGljeTogY29uZmlnLmljZVRyYW5zcG9ydFBvbGljeVxuICAgICAgICB9KSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbmZpZy5pY2VDYW5kaWRhdGVQb29sU2l6ZSA9IDA7XG4gICAgfVxuXG4gICAgdGhpcy5fY29uZmlnID0gY29uZmlnO1xuXG4gICAgLy8gcGVyLXRyYWNrIGljZUdhdGhlcnMsIGljZVRyYW5zcG9ydHMsIGR0bHNUcmFuc3BvcnRzLCBydHBTZW5kZXJzLCAuLi5cbiAgICAvLyBldmVyeXRoaW5nIHRoYXQgaXMgbmVlZGVkIHRvIGRlc2NyaWJlIGEgU0RQIG0tbGluZS5cbiAgICB0aGlzLnRyYW5zY2VpdmVycyA9IFtdO1xuXG4gICAgdGhpcy5fc2RwU2Vzc2lvbklkID0gU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQoKTtcbiAgICB0aGlzLl9zZHBTZXNzaW9uVmVyc2lvbiA9IDA7XG5cbiAgICB0aGlzLl9kdGxzUm9sZSA9IHVuZGVmaW5lZDsgLy8gcm9sZSBmb3IgYT1zZXR1cCB0byB1c2UgaW4gYW5zd2Vycy5cblxuICAgIHRoaXMuX2lzQ2xvc2VkID0gZmFsc2U7XG4gIH07XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ2xvY2FsRGVzY3JpcHRpb24nLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9jYWxEZXNjcmlwdGlvbjtcbiAgICB9XG4gIH0pO1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAncmVtb3RlRGVzY3JpcHRpb24nLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcmVtb3RlRGVzY3JpcHRpb247XG4gICAgfVxuICB9KTtcblxuICAvLyBzZXQgdXAgZXZlbnQgaGFuZGxlcnMgb24gcHJvdG90eXBlXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmljZWNhbmRpZGF0ZSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmFkZHN0cmVhbSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbnRyYWNrID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9ucmVtb3Zlc3RyZWFtID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uc2lnbmFsaW5nc3RhdGVjaGFuZ2UgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25pY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2UgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25jb25uZWN0aW9uc3RhdGVjaGFuZ2UgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25pY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbm5lZ290aWF0aW9ubmVlZGVkID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uZGF0YWNoYW5uZWwgPSBudWxsO1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fZGlzcGF0Y2hFdmVudCA9IGZ1bmN0aW9uKG5hbWUsIGV2ZW50KSB7XG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgaWYgKHR5cGVvZiB0aGlzWydvbicgKyBuYW1lXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpc1snb24nICsgbmFtZV0oZXZlbnQpO1xuICAgIH1cbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2VtaXRHYXRoZXJpbmdTdGF0ZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2UnKTtcbiAgICB0aGlzLl9kaXNwYXRjaEV2ZW50KCdpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZScsIGV2ZW50KTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0Q29uZmlndXJhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9jb25maWc7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldExvY2FsU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmxvY2FsU3RyZWFtcztcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVtb3RlU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnJlbW90ZVN0cmVhbXM7XG4gIH07XG5cbiAgLy8gaW50ZXJuYWwgaGVscGVyIHRvIGNyZWF0ZSBhIHRyYW5zY2VpdmVyIG9iamVjdC5cbiAgLy8gKHdoaWNoIGlzIG5vdCB5ZXQgdGhlIHNhbWUgYXMgdGhlIFdlYlJUQyAxLjAgdHJhbnNjZWl2ZXIpXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fY3JlYXRlVHJhbnNjZWl2ZXIgPSBmdW5jdGlvbihraW5kLCBkb05vdEFkZCkge1xuICAgIHZhciBoYXNCdW5kbGVUcmFuc3BvcnQgPSB0aGlzLnRyYW5zY2VpdmVycy5sZW5ndGggPiAwO1xuICAgIHZhciB0cmFuc2NlaXZlciA9IHtcbiAgICAgIHRyYWNrOiBudWxsLFxuICAgICAgaWNlR2F0aGVyZXI6IG51bGwsXG4gICAgICBpY2VUcmFuc3BvcnQ6IG51bGwsXG4gICAgICBkdGxzVHJhbnNwb3J0OiBudWxsLFxuICAgICAgbG9jYWxDYXBhYmlsaXRpZXM6IG51bGwsXG4gICAgICByZW1vdGVDYXBhYmlsaXRpZXM6IG51bGwsXG4gICAgICBydHBTZW5kZXI6IG51bGwsXG4gICAgICBydHBSZWNlaXZlcjogbnVsbCxcbiAgICAgIGtpbmQ6IGtpbmQsXG4gICAgICBtaWQ6IG51bGwsXG4gICAgICBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgcmVjdkVuY29kaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgIHN0cmVhbTogbnVsbCxcbiAgICAgIGFzc29jaWF0ZWRSZW1vdGVNZWRpYVN0cmVhbXM6IFtdLFxuICAgICAgd2FudFJlY2VpdmU6IHRydWVcbiAgICB9O1xuICAgIGlmICh0aGlzLnVzaW5nQnVuZGxlICYmIGhhc0J1bmRsZVRyYW5zcG9ydCkge1xuICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0ID0gdGhpcy50cmFuc2NlaXZlcnNbMF0uaWNlVHJhbnNwb3J0O1xuICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCA9IHRoaXMudHJhbnNjZWl2ZXJzWzBdLmR0bHNUcmFuc3BvcnQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciB0cmFuc3BvcnRzID0gdGhpcy5fY3JlYXRlSWNlQW5kRHRsc1RyYW5zcG9ydHMoKTtcbiAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCA9IHRyYW5zcG9ydHMuaWNlVHJhbnNwb3J0O1xuICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCA9IHRyYW5zcG9ydHMuZHRsc1RyYW5zcG9ydDtcbiAgICB9XG4gICAgaWYgKCFkb05vdEFkZCkge1xuICAgICAgdGhpcy50cmFuc2NlaXZlcnMucHVzaCh0cmFuc2NlaXZlcik7XG4gICAgfVxuICAgIHJldHVybiB0cmFuc2NlaXZlcjtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbih0cmFjaywgc3RyZWFtKSB7XG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSB7XG4gICAgICB0aHJvdyBtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQXR0ZW1wdGVkIHRvIGNhbGwgYWRkVHJhY2sgb24gYSBjbG9zZWQgcGVlcmNvbm5lY3Rpb24uJyk7XG4gICAgfVxuXG4gICAgdmFyIGFscmVhZHlFeGlzdHMgPSB0aGlzLnRyYW5zY2VpdmVycy5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICB9KTtcblxuICAgIGlmIChhbHJlYWR5RXhpc3RzKSB7XG4gICAgICB0aHJvdyBtYWtlRXJyb3IoJ0ludmFsaWRBY2Nlc3NFcnJvcicsICdUcmFjayBhbHJlYWR5IGV4aXN0cy4nKTtcbiAgICB9XG5cbiAgICB2YXIgdHJhbnNjZWl2ZXI7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRyYW5zY2VpdmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCF0aGlzLnRyYW5zY2VpdmVyc1tpXS50cmFjayAmJlxuICAgICAgICAgIHRoaXMudHJhbnNjZWl2ZXJzW2ldLmtpbmQgPT09IHRyYWNrLmtpbmQpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIgPSB0aGlzLnRyYW5zY2VpdmVyc1tpXTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCF0cmFuc2NlaXZlcikge1xuICAgICAgdHJhbnNjZWl2ZXIgPSB0aGlzLl9jcmVhdGVUcmFuc2NlaXZlcih0cmFjay5raW5kKTtcbiAgICB9XG5cbiAgICB0aGlzLl9tYXliZUZpcmVOZWdvdGlhdGlvbk5lZWRlZCgpO1xuXG4gICAgaWYgKHRoaXMubG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA9PT0gLTEpIHtcbiAgICAgIHRoaXMubG9jYWxTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICB9XG5cbiAgICB0cmFuc2NlaXZlci50cmFjayA9IHRyYWNrO1xuICAgIHRyYW5zY2VpdmVyLnN0cmVhbSA9IHN0cmVhbTtcbiAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIgPSBuZXcgd2luZG93LlJUQ1J0cFNlbmRlcih0cmFjayxcbiAgICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCk7XG4gICAgcmV0dXJuIHRyYW5zY2VpdmVyLnJ0cFNlbmRlcjtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICBpZiAoZWRnZVZlcnNpb24gPj0gMTUwMjUpIHtcbiAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgIHBjLmFkZFRyYWNrKHRyYWNrLCBzdHJlYW0pO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIENsb25lIGlzIG5lY2Vzc2FyeSBmb3IgbG9jYWwgZGVtb3MgbW9zdGx5LCBhdHRhY2hpbmcgZGlyZWN0bHlcbiAgICAgIC8vIHRvIHR3byBkaWZmZXJlbnQgc2VuZGVycyBkb2VzIG5vdCB3b3JrIChidWlsZCAxMDU0NykuXG4gICAgICAvLyBGaXhlZCBpbiAxNTAyNSAob3IgZWFybGllcilcbiAgICAgIHZhciBjbG9uZWRTdHJlYW0gPSBzdHJlYW0uY2xvbmUoKTtcbiAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrLCBpZHgpIHtcbiAgICAgICAgdmFyIGNsb25lZFRyYWNrID0gY2xvbmVkU3RyZWFtLmdldFRyYWNrcygpW2lkeF07XG4gICAgICAgIHRyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ2VuYWJsZWQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgIGNsb25lZFRyYWNrLmVuYWJsZWQgPSBldmVudC5lbmFibGVkO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgY2xvbmVkU3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgcGMuYWRkVHJhY2sodHJhY2ssIGNsb25lZFN0cmVhbSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrID0gZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgaWYgKHRoaXMuX2lzQ2xvc2VkKSB7XG4gICAgICB0aHJvdyBtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQXR0ZW1wdGVkIHRvIGNhbGwgcmVtb3ZlVHJhY2sgb24gYSBjbG9zZWQgcGVlcmNvbm5lY3Rpb24uJyk7XG4gICAgfVxuXG4gICAgaWYgKCEoc2VuZGVyIGluc3RhbmNlb2Ygd2luZG93LlJUQ1J0cFNlbmRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IDEgb2YgUlRDUGVlckNvbm5lY3Rpb24ucmVtb3ZlVHJhY2sgJyArXG4gICAgICAgICAgJ2RvZXMgbm90IGltcGxlbWVudCBpbnRlcmZhY2UgUlRDUnRwU2VuZGVyLicpO1xuICAgIH1cblxuICAgIHZhciB0cmFuc2NlaXZlciA9IHRoaXMudHJhbnNjZWl2ZXJzLmZpbmQoZnVuY3Rpb24odCkge1xuICAgICAgcmV0dXJuIHQucnRwU2VuZGVyID09PSBzZW5kZXI7XG4gICAgfSk7XG5cbiAgICBpZiAoIXRyYW5zY2VpdmVyKSB7XG4gICAgICB0aHJvdyBtYWtlRXJyb3IoJ0ludmFsaWRBY2Nlc3NFcnJvcicsXG4gICAgICAgICAgJ1NlbmRlciB3YXMgbm90IGNyZWF0ZWQgYnkgdGhpcyBjb25uZWN0aW9uLicpO1xuICAgIH1cbiAgICB2YXIgc3RyZWFtID0gdHJhbnNjZWl2ZXIuc3RyZWFtO1xuXG4gICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnN0b3AoKTtcbiAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIgPSBudWxsO1xuICAgIHRyYW5zY2VpdmVyLnRyYWNrID0gbnVsbDtcbiAgICB0cmFuc2NlaXZlci5zdHJlYW0gPSBudWxsO1xuXG4gICAgLy8gcmVtb3ZlIHRoZSBzdHJlYW0gZnJvbSB0aGUgc2V0IG9mIGxvY2FsIHN0cmVhbXNcbiAgICB2YXIgbG9jYWxTdHJlYW1zID0gdGhpcy50cmFuc2NlaXZlcnMubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICAgIHJldHVybiB0LnN0cmVhbTtcbiAgICB9KTtcbiAgICBpZiAobG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA9PT0gLTEgJiZcbiAgICAgICAgdGhpcy5sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID4gLTEpIHtcbiAgICAgIHRoaXMubG9jYWxTdHJlYW1zLnNwbGljZSh0aGlzLmxvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSksIDEpO1xuICAgIH1cblxuICAgIHRoaXMuX21heWJlRmlyZU5lZ290aWF0aW9uTmVlZGVkKCk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgIHZhciBzZW5kZXIgPSBwYy5nZXRTZW5kZXJzKCkuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgIH0pO1xuICAgICAgaWYgKHNlbmRlcikge1xuICAgICAgICBwYy5yZW1vdmVUcmFjayhzZW5kZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMudHJhbnNjZWl2ZXJzLmZpbHRlcihmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgcmV0dXJuICEhdHJhbnNjZWl2ZXIucnRwU2VuZGVyO1xuICAgIH0pXG4gICAgLm1hcChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgcmV0dXJuIHRyYW5zY2VpdmVyLnJ0cFNlbmRlcjtcbiAgICB9KTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMudHJhbnNjZWl2ZXJzLmZpbHRlcihmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgcmV0dXJuICEhdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgfSlcbiAgICAubWFwKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICByZXR1cm4gdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgfSk7XG4gIH07XG5cblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZUljZUdhdGhlcmVyID0gZnVuY3Rpb24oc2RwTUxpbmVJbmRleCxcbiAgICAgIHVzaW5nQnVuZGxlKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICBpZiAodXNpbmdCdW5kbGUgJiYgc2RwTUxpbmVJbmRleCA+IDApIHtcbiAgICAgIHJldHVybiB0aGlzLnRyYW5zY2VpdmVyc1swXS5pY2VHYXRoZXJlcjtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2ljZUdhdGhlcmVycy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiB0aGlzLl9pY2VHYXRoZXJlcnMuc2hpZnQoKTtcbiAgICB9XG4gICAgdmFyIGljZUdhdGhlcmVyID0gbmV3IHdpbmRvdy5SVENJY2VHYXRoZXJlcih7XG4gICAgICBpY2VTZXJ2ZXJzOiB0aGlzLl9jb25maWcuaWNlU2VydmVycyxcbiAgICAgIGdhdGhlclBvbGljeTogdGhpcy5fY29uZmlnLmljZVRyYW5zcG9ydFBvbGljeVxuICAgIH0pO1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShpY2VHYXRoZXJlciwgJ3N0YXRlJyxcbiAgICAgICAge3ZhbHVlOiAnbmV3Jywgd3JpdGFibGU6IHRydWV9XG4gICAgKTtcblxuICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzID0gW107XG4gICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyQ2FuZGlkYXRlcyA9IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICB2YXIgZW5kID0gIWV2ZW50LmNhbmRpZGF0ZSB8fCBPYmplY3Qua2V5cyhldmVudC5jYW5kaWRhdGUpLmxlbmd0aCA9PT0gMDtcbiAgICAgIC8vIHBvbHlmaWxsIHNpbmNlIFJUQ0ljZUdhdGhlcmVyLnN0YXRlIGlzIG5vdCBpbXBsZW1lbnRlZCBpblxuICAgICAgLy8gRWRnZSAxMDU0NyB5ZXQuXG4gICAgICBpY2VHYXRoZXJlci5zdGF0ZSA9IGVuZCA/ICdjb21wbGV0ZWQnIDogJ2dhdGhlcmluZyc7XG4gICAgICBpZiAocGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzICE9PSBudWxsKSB7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJlZENhbmRpZGF0ZUV2ZW50cy5wdXNoKGV2ZW50KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGljZUdhdGhlcmVyLmFkZEV2ZW50TGlzdGVuZXIoJ2xvY2FsY2FuZGlkYXRlJyxcbiAgICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlckNhbmRpZGF0ZXMpO1xuICAgIHJldHVybiBpY2VHYXRoZXJlcjtcbiAgfTtcblxuICAvLyBzdGFydCBnYXRoZXJpbmcgZnJvbSBhbiBSVENJY2VHYXRoZXJlci5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9nYXRoZXIgPSBmdW5jdGlvbihtaWQsIHNkcE1MaW5lSW5kZXgpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIHZhciBpY2VHYXRoZXJlciA9IHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZUdhdGhlcmVyO1xuICAgIGlmIChpY2VHYXRoZXJlci5vbmxvY2FsY2FuZGlkYXRlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBidWZmZXJlZENhbmRpZGF0ZUV2ZW50cyA9XG4gICAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJlZENhbmRpZGF0ZUV2ZW50cztcbiAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJlZENhbmRpZGF0ZUV2ZW50cyA9IG51bGw7XG4gICAgaWNlR2F0aGVyZXIucmVtb3ZlRXZlbnRMaXN0ZW5lcignbG9jYWxjYW5kaWRhdGUnLFxuICAgICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyQ2FuZGlkYXRlcyk7XG4gICAgaWNlR2F0aGVyZXIub25sb2NhbGNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGV2dCkge1xuICAgICAgaWYgKHBjLnVzaW5nQnVuZGxlICYmIHNkcE1MaW5lSW5kZXggPiAwKSB7XG4gICAgICAgIC8vIGlmIHdlIGtub3cgdGhhdCB3ZSB1c2UgYnVuZGxlIHdlIGNhbiBkcm9wIGNhbmRpZGF0ZXMgd2l0aFxuICAgICAgICAvLyDRlWRwTUxpbmVJbmRleCA+IDAuIElmIHdlIGRvbid0IGRvIHRoaXMgdGhlbiBvdXIgc3RhdGUgZ2V0c1xuICAgICAgICAvLyBjb25mdXNlZCBzaW5jZSB3ZSBkaXNwb3NlIHRoZSBleHRyYSBpY2UgZ2F0aGVyZXIuXG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnaWNlY2FuZGlkYXRlJyk7XG4gICAgICBldmVudC5jYW5kaWRhdGUgPSB7c2RwTWlkOiBtaWQsIHNkcE1MaW5lSW5kZXg6IHNkcE1MaW5lSW5kZXh9O1xuXG4gICAgICB2YXIgY2FuZCA9IGV2dC5jYW5kaWRhdGU7XG4gICAgICAvLyBFZGdlIGVtaXRzIGFuIGVtcHR5IG9iamVjdCBmb3IgUlRDSWNlQ2FuZGlkYXRlQ29tcGxldGXigKVcbiAgICAgIHZhciBlbmQgPSAhY2FuZCB8fCBPYmplY3Qua2V5cyhjYW5kKS5sZW5ndGggPT09IDA7XG4gICAgICBpZiAoZW5kKSB7XG4gICAgICAgIC8vIHBvbHlmaWxsIHNpbmNlIFJUQ0ljZUdhdGhlcmVyLnN0YXRlIGlzIG5vdCBpbXBsZW1lbnRlZCBpblxuICAgICAgICAvLyBFZGdlIDEwNTQ3IHlldC5cbiAgICAgICAgaWYgKGljZUdhdGhlcmVyLnN0YXRlID09PSAnbmV3JyB8fCBpY2VHYXRoZXJlci5zdGF0ZSA9PT0gJ2dhdGhlcmluZycpIHtcbiAgICAgICAgICBpY2VHYXRoZXJlci5zdGF0ZSA9ICdjb21wbGV0ZWQnO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoaWNlR2F0aGVyZXIuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgaWNlR2F0aGVyZXIuc3RhdGUgPSAnZ2F0aGVyaW5nJztcbiAgICAgICAgfVxuICAgICAgICAvLyBSVENJY2VDYW5kaWRhdGUgZG9lc24ndCBoYXZlIGEgY29tcG9uZW50LCBuZWVkcyB0byBiZSBhZGRlZFxuICAgICAgICBjYW5kLmNvbXBvbmVudCA9IDE7XG4gICAgICAgIC8vIGFsc28gdGhlIHVzZXJuYW1lRnJhZ21lbnQuIFRPRE86IHVwZGF0ZSBTRFAgdG8gdGFrZSBib3RoIHZhcmlhbnRzLlxuICAgICAgICBjYW5kLnVmcmFnID0gaWNlR2F0aGVyZXIuZ2V0TG9jYWxQYXJhbWV0ZXJzKCkudXNlcm5hbWVGcmFnbWVudDtcblxuICAgICAgICB2YXIgc2VyaWFsaXplZENhbmRpZGF0ZSA9IFNEUFV0aWxzLndyaXRlQ2FuZGlkYXRlKGNhbmQpO1xuICAgICAgICBldmVudC5jYW5kaWRhdGUgPSBPYmplY3QuYXNzaWduKGV2ZW50LmNhbmRpZGF0ZSxcbiAgICAgICAgICAgIFNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlKHNlcmlhbGl6ZWRDYW5kaWRhdGUpKTtcblxuICAgICAgICBldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlID0gc2VyaWFsaXplZENhbmRpZGF0ZTtcbiAgICAgICAgZXZlbnQuY2FuZGlkYXRlLnRvSlNPTiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjYW5kaWRhdGU6IGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUsXG4gICAgICAgICAgICBzZHBNaWQ6IGV2ZW50LmNhbmRpZGF0ZS5zZHBNaWQsXG4gICAgICAgICAgICBzZHBNTGluZUluZGV4OiBldmVudC5jYW5kaWRhdGUuc2RwTUxpbmVJbmRleCxcbiAgICAgICAgICAgIHVzZXJuYW1lRnJhZ21lbnQ6IGV2ZW50LmNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50XG4gICAgICAgICAgfTtcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gdXBkYXRlIGxvY2FsIGRlc2NyaXB0aW9uLlxuICAgICAgdmFyIHNlY3Rpb25zID0gU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyhwYy5fbG9jYWxEZXNjcmlwdGlvbi5zZHApO1xuICAgICAgaWYgKCFlbmQpIHtcbiAgICAgICAgc2VjdGlvbnNbZXZlbnQuY2FuZGlkYXRlLnNkcE1MaW5lSW5kZXhdICs9XG4gICAgICAgICAgICAnYT0nICsgZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSArICdcXHJcXG4nO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VjdGlvbnNbZXZlbnQuY2FuZGlkYXRlLnNkcE1MaW5lSW5kZXhdICs9XG4gICAgICAgICAgICAnYT1lbmQtb2YtY2FuZGlkYXRlc1xcclxcbic7XG4gICAgICB9XG4gICAgICBwYy5fbG9jYWxEZXNjcmlwdGlvbi5zZHAgPVxuICAgICAgICAgIFNEUFV0aWxzLmdldERlc2NyaXB0aW9uKHBjLl9sb2NhbERlc2NyaXB0aW9uLnNkcCkgK1xuICAgICAgICAgIHNlY3Rpb25zLmpvaW4oJycpO1xuICAgICAgdmFyIGNvbXBsZXRlID0gcGMudHJhbnNjZWl2ZXJzLmV2ZXJ5KGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgIHJldHVybiB0cmFuc2NlaXZlci5pY2VHYXRoZXJlciAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuc3RhdGUgPT09ICdjb21wbGV0ZWQnO1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChwYy5pY2VHYXRoZXJpbmdTdGF0ZSAhPT0gJ2dhdGhlcmluZycpIHtcbiAgICAgICAgcGMuaWNlR2F0aGVyaW5nU3RhdGUgPSAnZ2F0aGVyaW5nJztcbiAgICAgICAgcGMuX2VtaXRHYXRoZXJpbmdTdGF0ZUNoYW5nZSgpO1xuICAgICAgfVxuXG4gICAgICAvLyBFbWl0IGNhbmRpZGF0ZS4gQWxzbyBlbWl0IG51bGwgY2FuZGlkYXRlIHdoZW4gYWxsIGdhdGhlcmVycyBhcmVcbiAgICAgIC8vIGNvbXBsZXRlLlxuICAgICAgaWYgKCFlbmQpIHtcbiAgICAgICAgcGMuX2Rpc3BhdGNoRXZlbnQoJ2ljZWNhbmRpZGF0ZScsIGV2ZW50KTtcbiAgICAgIH1cbiAgICAgIGlmIChjb21wbGV0ZSkge1xuICAgICAgICBwYy5fZGlzcGF0Y2hFdmVudCgnaWNlY2FuZGlkYXRlJywgbmV3IEV2ZW50KCdpY2VjYW5kaWRhdGUnKSk7XG4gICAgICAgIHBjLmljZUdhdGhlcmluZ1N0YXRlID0gJ2NvbXBsZXRlJztcbiAgICAgICAgcGMuX2VtaXRHYXRoZXJpbmdTdGF0ZUNoYW5nZSgpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBlbWl0IGFscmVhZHkgZ2F0aGVyZWQgY2FuZGlkYXRlcy5cbiAgICB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZSkge1xuICAgICAgICBpY2VHYXRoZXJlci5vbmxvY2FsY2FuZGlkYXRlKGUpO1xuICAgICAgfSk7XG4gICAgfSwgMCk7XG4gIH07XG5cbiAgLy8gQ3JlYXRlIElDRSB0cmFuc3BvcnQgYW5kIERUTFMgdHJhbnNwb3J0LlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZUljZUFuZER0bHNUcmFuc3BvcnRzID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICB2YXIgaWNlVHJhbnNwb3J0ID0gbmV3IHdpbmRvdy5SVENJY2VUcmFuc3BvcnQobnVsbCk7XG4gICAgaWNlVHJhbnNwb3J0Lm9uaWNlc3RhdGVjaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgICAgIHBjLl91cGRhdGVJY2VDb25uZWN0aW9uU3RhdGUoKTtcbiAgICAgIHBjLl91cGRhdGVDb25uZWN0aW9uU3RhdGUoKTtcbiAgICB9O1xuXG4gICAgdmFyIGR0bHNUcmFuc3BvcnQgPSBuZXcgd2luZG93LlJUQ0R0bHNUcmFuc3BvcnQoaWNlVHJhbnNwb3J0KTtcbiAgICBkdGxzVHJhbnNwb3J0Lm9uZHRsc3N0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gICAgICBwYy5fdXBkYXRlQ29ubmVjdGlvblN0YXRlKCk7XG4gICAgfTtcbiAgICBkdGxzVHJhbnNwb3J0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIC8vIG9uZXJyb3IgZG9lcyBub3Qgc2V0IHN0YXRlIHRvIGZhaWxlZCBieSBpdHNlbGYuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoZHRsc1RyYW5zcG9ydCwgJ3N0YXRlJyxcbiAgICAgICAgICB7dmFsdWU6ICdmYWlsZWQnLCB3cml0YWJsZTogdHJ1ZX0pO1xuICAgICAgcGMuX3VwZGF0ZUNvbm5lY3Rpb25TdGF0ZSgpO1xuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgaWNlVHJhbnNwb3J0OiBpY2VUcmFuc3BvcnQsXG4gICAgICBkdGxzVHJhbnNwb3J0OiBkdGxzVHJhbnNwb3J0XG4gICAgfTtcbiAgfTtcblxuICAvLyBEZXN0cm95IElDRSBnYXRoZXJlciwgSUNFIHRyYW5zcG9ydCBhbmQgRFRMUyB0cmFuc3BvcnQuXG4gIC8vIFdpdGhvdXQgdHJpZ2dlcmluZyB0aGUgY2FsbGJhY2tzLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2Rpc3Bvc2VJY2VBbmREdGxzVHJhbnNwb3J0cyA9IGZ1bmN0aW9uKFxuICAgICAgc2RwTUxpbmVJbmRleCkge1xuICAgIHZhciBpY2VHYXRoZXJlciA9IHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZUdhdGhlcmVyO1xuICAgIGlmIChpY2VHYXRoZXJlcikge1xuICAgICAgZGVsZXRlIGljZUdhdGhlcmVyLm9ubG9jYWxjYW5kaWRhdGU7XG4gICAgICBkZWxldGUgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlR2F0aGVyZXI7XG4gICAgfVxuICAgIHZhciBpY2VUcmFuc3BvcnQgPSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VUcmFuc3BvcnQ7XG4gICAgaWYgKGljZVRyYW5zcG9ydCkge1xuICAgICAgZGVsZXRlIGljZVRyYW5zcG9ydC5vbmljZXN0YXRlY2hhbmdlO1xuICAgICAgZGVsZXRlIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZVRyYW5zcG9ydDtcbiAgICB9XG4gICAgdmFyIGR0bHNUcmFuc3BvcnQgPSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5kdGxzVHJhbnNwb3J0O1xuICAgIGlmIChkdGxzVHJhbnNwb3J0KSB7XG4gICAgICBkZWxldGUgZHRsc1RyYW5zcG9ydC5vbmR0bHNzdGF0ZWNoYW5nZTtcbiAgICAgIGRlbGV0ZSBkdGxzVHJhbnNwb3J0Lm9uZXJyb3I7XG4gICAgICBkZWxldGUgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uZHRsc1RyYW5zcG9ydDtcbiAgICB9XG4gIH07XG5cbiAgLy8gU3RhcnQgdGhlIFJUUCBTZW5kZXIgYW5kIFJlY2VpdmVyIGZvciBhIHRyYW5zY2VpdmVyLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX3RyYW5zY2VpdmUgPSBmdW5jdGlvbih0cmFuc2NlaXZlcixcbiAgICAgIHNlbmQsIHJlY3YpIHtcbiAgICB2YXIgcGFyYW1zID0gZ2V0Q29tbW9uQ2FwYWJpbGl0aWVzKHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzLFxuICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMpO1xuICAgIGlmIChzZW5kICYmIHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgICAgcGFyYW1zLmVuY29kaW5ncyA9IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICBwYXJhbXMucnRjcCA9IHtcbiAgICAgICAgY25hbWU6IFNEUFV0aWxzLmxvY2FsQ05hbWUsXG4gICAgICAgIGNvbXBvdW5kOiB0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycy5jb21wb3VuZFxuICAgICAgfTtcbiAgICAgIGlmICh0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCkge1xuICAgICAgICBwYXJhbXMucnRjcC5zc3JjID0gdHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjO1xuICAgICAgfVxuICAgICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnNlbmQocGFyYW1zKTtcbiAgICB9XG4gICAgaWYgKHJlY3YgJiYgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgJiYgcGFyYW1zLmNvZGVjcy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyByZW1vdmUgUlRYIGZpZWxkIGluIEVkZ2UgMTQ5NDJcbiAgICAgIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAndmlkZW8nXG4gICAgICAgICAgJiYgdHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVyc1xuICAgICAgICAgICYmIGVkZ2VWZXJzaW9uIDwgMTUwMTkpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVycy5mb3JFYWNoKGZ1bmN0aW9uKHApIHtcbiAgICAgICAgICBkZWxldGUgcC5ydHg7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoKSB7XG4gICAgICAgIHBhcmFtcy5lbmNvZGluZ3MgPSB0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyYW1zLmVuY29kaW5ncyA9IFt7fV07XG4gICAgICB9XG4gICAgICBwYXJhbXMucnRjcCA9IHtcbiAgICAgICAgY29tcG91bmQ6IHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kXG4gICAgICB9O1xuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzLmNuYW1lKSB7XG4gICAgICAgIHBhcmFtcy5ydGNwLmNuYW1lID0gdHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMuY25hbWU7XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGgpIHtcbiAgICAgICAgcGFyYW1zLnJ0Y3Auc3NyYyA9IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYztcbiAgICAgIH1cbiAgICAgIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyLnJlY2VpdmUocGFyYW1zKTtcbiAgICB9XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldExvY2FsRGVzY3JpcHRpb24gPSBmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgIHZhciBwYyA9IHRoaXM7XG5cbiAgICAvLyBOb3RlOiBwcmFuc3dlciBpcyBub3Qgc3VwcG9ydGVkLlxuICAgIGlmIChbJ29mZmVyJywgJ2Fuc3dlciddLmluZGV4T2YoZGVzY3JpcHRpb24udHlwZSkgPT09IC0xKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdUeXBlRXJyb3InLFxuICAgICAgICAgICdVbnN1cHBvcnRlZCB0eXBlIFwiJyArIGRlc2NyaXB0aW9uLnR5cGUgKyAnXCInKSk7XG4gICAgfVxuXG4gICAgaWYgKCFpc0FjdGlvbkFsbG93ZWRJblNpZ25hbGluZ1N0YXRlKCdzZXRMb2NhbERlc2NyaXB0aW9uJyxcbiAgICAgICAgZGVzY3JpcHRpb24udHlwZSwgcGMuc2lnbmFsaW5nU3RhdGUpIHx8IHBjLl9pc0Nsb3NlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdDYW4gbm90IHNldCBsb2NhbCAnICsgZGVzY3JpcHRpb24udHlwZSArXG4gICAgICAgICAgJyBpbiBzdGF0ZSAnICsgcGMuc2lnbmFsaW5nU3RhdGUpKTtcbiAgICB9XG5cbiAgICB2YXIgc2VjdGlvbnM7XG4gICAgdmFyIHNlc3Npb25wYXJ0O1xuICAgIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInKSB7XG4gICAgICAvLyBWRVJZIGxpbWl0ZWQgc3VwcG9ydCBmb3IgU0RQIG11bmdpbmcuIExpbWl0ZWQgdG86XG4gICAgICAvLyAqIGNoYW5naW5nIHRoZSBvcmRlciBvZiBjb2RlY3NcbiAgICAgIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhkZXNjcmlwdGlvbi5zZHApO1xuICAgICAgc2Vzc2lvbnBhcnQgPSBzZWN0aW9ucy5zaGlmdCgpO1xuICAgICAgc2VjdGlvbnMuZm9yRWFjaChmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgICAgdmFyIGNhcHMgPSBTRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmxvY2FsQ2FwYWJpbGl0aWVzID0gY2FwcztcbiAgICAgIH0pO1xuXG4gICAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlciwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgICBwYy5fZ2F0aGVyKHRyYW5zY2VpdmVyLm1pZCwgc2RwTUxpbmVJbmRleCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdhbnN3ZXInKSB7XG4gICAgICBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMocGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCk7XG4gICAgICBzZXNzaW9ucGFydCA9IHNlY3Rpb25zLnNoaWZ0KCk7XG4gICAgICB2YXIgaXNJY2VMaXRlID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoc2Vzc2lvbnBhcnQsXG4gICAgICAgICAgJ2E9aWNlLWxpdGUnKS5sZW5ndGggPiAwO1xuICAgICAgc2VjdGlvbnMuZm9yRWFjaChmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgICAgdmFyIHRyYW5zY2VpdmVyID0gcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdO1xuICAgICAgICB2YXIgaWNlR2F0aGVyZXIgPSB0cmFuc2NlaXZlci5pY2VHYXRoZXJlcjtcbiAgICAgICAgdmFyIGljZVRyYW5zcG9ydCA9IHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydDtcbiAgICAgICAgdmFyIGR0bHNUcmFuc3BvcnQgPSB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0O1xuICAgICAgICB2YXIgbG9jYWxDYXBhYmlsaXRpZXMgPSB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcztcbiAgICAgICAgdmFyIHJlbW90ZUNhcGFiaWxpdGllcyA9IHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcztcblxuICAgICAgICAvLyB0cmVhdCBidW5kbGUtb25seSBhcyBub3QtcmVqZWN0ZWQuXG4gICAgICAgIHZhciByZWplY3RlZCA9IFNEUFV0aWxzLmlzUmVqZWN0ZWQobWVkaWFTZWN0aW9uKSAmJlxuICAgICAgICAgICAgU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1idW5kbGUtb25seScpLmxlbmd0aCA9PT0gMDtcblxuICAgICAgICBpZiAoIXJlamVjdGVkICYmICF0cmFuc2NlaXZlci5yZWplY3RlZCkge1xuICAgICAgICAgIHZhciByZW1vdGVJY2VQYXJhbWV0ZXJzID0gU0RQVXRpbHMuZ2V0SWNlUGFyYW1ldGVycyhcbiAgICAgICAgICAgICAgbWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCk7XG4gICAgICAgICAgdmFyIHJlbW90ZUR0bHNQYXJhbWV0ZXJzID0gU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMoXG4gICAgICAgICAgICAgIG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpO1xuICAgICAgICAgIGlmIChpc0ljZUxpdGUpIHtcbiAgICAgICAgICAgIHJlbW90ZUR0bHNQYXJhbWV0ZXJzLnJvbGUgPSAnc2VydmVyJztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoIXBjLnVzaW5nQnVuZGxlIHx8IHNkcE1MaW5lSW5kZXggPT09IDApIHtcbiAgICAgICAgICAgIHBjLl9nYXRoZXIodHJhbnNjZWl2ZXIubWlkLCBzZHBNTGluZUluZGV4KTtcbiAgICAgICAgICAgIGlmIChpY2VUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgICAgIGljZVRyYW5zcG9ydC5zdGFydChpY2VHYXRoZXJlciwgcmVtb3RlSWNlUGFyYW1ldGVycyxcbiAgICAgICAgICAgICAgICAgIGlzSWNlTGl0ZSA/ICdjb250cm9sbGluZycgOiAnY29udHJvbGxlZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGR0bHNUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgICAgIGR0bHNUcmFuc3BvcnQuc3RhcnQocmVtb3RlRHRsc1BhcmFtZXRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIENhbGN1bGF0ZSBpbnRlcnNlY3Rpb24gb2YgY2FwYWJpbGl0aWVzLlxuICAgICAgICAgIHZhciBwYXJhbXMgPSBnZXRDb21tb25DYXBhYmlsaXRpZXMobG9jYWxDYXBhYmlsaXRpZXMsXG4gICAgICAgICAgICAgIHJlbW90ZUNhcGFiaWxpdGllcyk7XG5cbiAgICAgICAgICAvLyBTdGFydCB0aGUgUlRDUnRwU2VuZGVyLiBUaGUgUlRDUnRwUmVjZWl2ZXIgZm9yIHRoaXNcbiAgICAgICAgICAvLyB0cmFuc2NlaXZlciBoYXMgYWxyZWFkeSBiZWVuIHN0YXJ0ZWQgaW4gc2V0UmVtb3RlRGVzY3JpcHRpb24uXG4gICAgICAgICAgcGMuX3RyYW5zY2VpdmUodHJhbnNjZWl2ZXIsXG4gICAgICAgICAgICAgIHBhcmFtcy5jb2RlY3MubGVuZ3RoID4gMCxcbiAgICAgICAgICAgICAgZmFsc2UpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBwYy5fbG9jYWxEZXNjcmlwdGlvbiA9IHtcbiAgICAgIHR5cGU6IGRlc2NyaXB0aW9uLnR5cGUsXG4gICAgICBzZHA6IGRlc2NyaXB0aW9uLnNkcFxuICAgIH07XG4gICAgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicpIHtcbiAgICAgIHBjLl91cGRhdGVTaWduYWxpbmdTdGF0ZSgnaGF2ZS1sb2NhbC1vZmZlcicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYy5fdXBkYXRlU2lnbmFsaW5nU3RhdGUoJ3N0YWJsZScpO1xuICAgIH1cblxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb24gPSBmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgIHZhciBwYyA9IHRoaXM7XG5cbiAgICAvLyBOb3RlOiBwcmFuc3dlciBpcyBub3Qgc3VwcG9ydGVkLlxuICAgIGlmIChbJ29mZmVyJywgJ2Fuc3dlciddLmluZGV4T2YoZGVzY3JpcHRpb24udHlwZSkgPT09IC0xKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdUeXBlRXJyb3InLFxuICAgICAgICAgICdVbnN1cHBvcnRlZCB0eXBlIFwiJyArIGRlc2NyaXB0aW9uLnR5cGUgKyAnXCInKSk7XG4gICAgfVxuXG4gICAgaWYgKCFpc0FjdGlvbkFsbG93ZWRJblNpZ25hbGluZ1N0YXRlKCdzZXRSZW1vdGVEZXNjcmlwdGlvbicsXG4gICAgICAgIGRlc2NyaXB0aW9uLnR5cGUsIHBjLnNpZ25hbGluZ1N0YXRlKSB8fCBwYy5faXNDbG9zZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQ2FuIG5vdCBzZXQgcmVtb3RlICcgKyBkZXNjcmlwdGlvbi50eXBlICtcbiAgICAgICAgICAnIGluIHN0YXRlICcgKyBwYy5zaWduYWxpbmdTdGF0ZSkpO1xuICAgIH1cblxuICAgIHZhciBzdHJlYW1zID0ge307XG4gICAgcGMucmVtb3RlU3RyZWFtcy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgc3RyZWFtc1tzdHJlYW0uaWRdID0gc3RyZWFtO1xuICAgIH0pO1xuICAgIHZhciByZWNlaXZlckxpc3QgPSBbXTtcbiAgICB2YXIgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGRlc2NyaXB0aW9uLnNkcCk7XG4gICAgdmFyIHNlc3Npb25wYXJ0ID0gc2VjdGlvbnMuc2hpZnQoKTtcbiAgICB2YXIgaXNJY2VMaXRlID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoc2Vzc2lvbnBhcnQsXG4gICAgICAgICdhPWljZS1saXRlJykubGVuZ3RoID4gMDtcbiAgICB2YXIgdXNpbmdCdW5kbGUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChzZXNzaW9ucGFydCxcbiAgICAgICAgJ2E9Z3JvdXA6QlVORExFICcpLmxlbmd0aCA+IDA7XG4gICAgcGMudXNpbmdCdW5kbGUgPSB1c2luZ0J1bmRsZTtcbiAgICB2YXIgaWNlT3B0aW9ucyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KHNlc3Npb25wYXJ0LFxuICAgICAgICAnYT1pY2Utb3B0aW9uczonKVswXTtcbiAgICBpZiAoaWNlT3B0aW9ucykge1xuICAgICAgcGMuY2FuVHJpY2tsZUljZUNhbmRpZGF0ZXMgPSBpY2VPcHRpb25zLnN1YnN0cigxNCkuc3BsaXQoJyAnKVxuICAgICAgICAgIC5pbmRleE9mKCd0cmlja2xlJykgPj0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgcGMuY2FuVHJpY2tsZUljZUNhbmRpZGF0ZXMgPSBmYWxzZTtcbiAgICB9XG5cbiAgICBzZWN0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICAgICAgdmFyIGtpbmQgPSBTRFBVdGlscy5nZXRLaW5kKG1lZGlhU2VjdGlvbik7XG4gICAgICAvLyB0cmVhdCBidW5kbGUtb25seSBhcyBub3QtcmVqZWN0ZWQuXG4gICAgICB2YXIgcmVqZWN0ZWQgPSBTRFBVdGlscy5pc1JlamVjdGVkKG1lZGlhU2VjdGlvbikgJiZcbiAgICAgICAgICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWJ1bmRsZS1vbmx5JykubGVuZ3RoID09PSAwO1xuICAgICAgdmFyIHByb3RvY29sID0gbGluZXNbMF0uc3Vic3RyKDIpLnNwbGl0KCcgJylbMl07XG5cbiAgICAgIHZhciBkaXJlY3Rpb24gPSBTRFBVdGlscy5nZXREaXJlY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCk7XG4gICAgICB2YXIgcmVtb3RlTXNpZCA9IFNEUFV0aWxzLnBhcnNlTXNpZChtZWRpYVNlY3Rpb24pO1xuXG4gICAgICB2YXIgbWlkID0gU0RQVXRpbHMuZ2V0TWlkKG1lZGlhU2VjdGlvbikgfHwgU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbiAgICAgIC8vIFJlamVjdCBkYXRhY2hhbm5lbHMgd2hpY2ggYXJlIG5vdCBpbXBsZW1lbnRlZCB5ZXQuXG4gICAgICBpZiAoKGtpbmQgPT09ICdhcHBsaWNhdGlvbicgJiYgcHJvdG9jb2wgPT09ICdEVExTL1NDVFAnKSB8fCByZWplY3RlZCkge1xuICAgICAgICAvLyBUT0RPOiB0aGlzIGlzIGRhbmdlcm91cyBpbiB0aGUgY2FzZSB3aGVyZSBhIG5vbi1yZWplY3RlZCBtLWxpbmVcbiAgICAgICAgLy8gICAgIGJlY29tZXMgcmVqZWN0ZWQuXG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSA9IHtcbiAgICAgICAgICBtaWQ6IG1pZCxcbiAgICAgICAgICBraW5kOiBraW5kLFxuICAgICAgICAgIHJlamVjdGVkOiB0cnVlXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZWplY3RlZCAmJiBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0gJiZcbiAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucmVqZWN0ZWQpIHtcbiAgICAgICAgLy8gcmVjeWNsZSBhIHJlamVjdGVkIHRyYW5zY2VpdmVyLlxuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0gPSBwYy5fY3JlYXRlVHJhbnNjZWl2ZXIoa2luZCwgdHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIHZhciB0cmFuc2NlaXZlcjtcbiAgICAgIHZhciBpY2VHYXRoZXJlcjtcbiAgICAgIHZhciBpY2VUcmFuc3BvcnQ7XG4gICAgICB2YXIgZHRsc1RyYW5zcG9ydDtcbiAgICAgIHZhciBydHBSZWNlaXZlcjtcbiAgICAgIHZhciBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgdmFyIHJlY3ZFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICB2YXIgbG9jYWxDYXBhYmlsaXRpZXM7XG5cbiAgICAgIHZhciB0cmFjaztcbiAgICAgIC8vIEZJWE1FOiBlbnN1cmUgdGhlIG1lZGlhU2VjdGlvbiBoYXMgcnRjcC1tdXggc2V0LlxuICAgICAgdmFyIHJlbW90ZUNhcGFiaWxpdGllcyA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICAgICAgdmFyIHJlbW90ZUljZVBhcmFtZXRlcnM7XG4gICAgICB2YXIgcmVtb3RlRHRsc1BhcmFtZXRlcnM7XG4gICAgICBpZiAoIXJlamVjdGVkKSB7XG4gICAgICAgIHJlbW90ZUljZVBhcmFtZXRlcnMgPSBTRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbixcbiAgICAgICAgICAgIHNlc3Npb25wYXJ0KTtcbiAgICAgICAgcmVtb3RlRHRsc1BhcmFtZXRlcnMgPSBTRFBVdGlscy5nZXREdGxzUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24sXG4gICAgICAgICAgICBzZXNzaW9ucGFydCk7XG4gICAgICAgIHJlbW90ZUR0bHNQYXJhbWV0ZXJzLnJvbGUgPSAnY2xpZW50JztcbiAgICAgIH1cbiAgICAgIHJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMgPVxuICAgICAgICAgIFNEUFV0aWxzLnBhcnNlUnRwRW5jb2RpbmdQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG5cbiAgICAgIHZhciBydGNwUGFyYW1ldGVycyA9IFNEUFV0aWxzLnBhcnNlUnRjcFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcblxuICAgICAgdmFyIGlzQ29tcGxldGUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sXG4gICAgICAgICAgJ2E9ZW5kLW9mLWNhbmRpZGF0ZXMnLCBzZXNzaW9ucGFydCkubGVuZ3RoID4gMDtcbiAgICAgIHZhciBjYW5kcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9Y2FuZGlkYXRlOicpXG4gICAgICAgICAgLm1hcChmdW5jdGlvbihjYW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUoY2FuZCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuZmlsdGVyKGZ1bmN0aW9uKGNhbmQpIHtcbiAgICAgICAgICAgIHJldHVybiBjYW5kLmNvbXBvbmVudCA9PT0gMTtcbiAgICAgICAgICB9KTtcblxuICAgICAgLy8gQ2hlY2sgaWYgd2UgY2FuIHVzZSBCVU5ETEUgYW5kIGRpc3Bvc2UgdHJhbnNwb3J0cy5cbiAgICAgIGlmICgoZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJyB8fCBkZXNjcmlwdGlvbi50eXBlID09PSAnYW5zd2VyJykgJiZcbiAgICAgICAgICAhcmVqZWN0ZWQgJiYgdXNpbmdCdW5kbGUgJiYgc2RwTUxpbmVJbmRleCA+IDAgJiZcbiAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0pIHtcbiAgICAgICAgcGMuX2Rpc3Bvc2VJY2VBbmREdGxzVHJhbnNwb3J0cyhzZHBNTGluZUluZGV4KTtcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZUdhdGhlcmVyID1cbiAgICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1swXS5pY2VHYXRoZXJlcjtcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZVRyYW5zcG9ydCA9XG4gICAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbMF0uaWNlVHJhbnNwb3J0O1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uZHRsc1RyYW5zcG9ydCA9XG4gICAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbMF0uZHRsc1RyYW5zcG9ydDtcbiAgICAgICAgaWYgKHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5ydHBTZW5kZXIpIHtcbiAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucnRwU2VuZGVyLnNldFRyYW5zcG9ydChcbiAgICAgICAgICAgICAgcGMudHJhbnNjZWl2ZXJzWzBdLmR0bHNUcmFuc3BvcnQpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucnRwUmVjZWl2ZXIpIHtcbiAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucnRwUmVjZWl2ZXIuc2V0VHJhbnNwb3J0KFxuICAgICAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbMF0uZHRsc1RyYW5zcG9ydCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInICYmICFyZWplY3RlZCkge1xuICAgICAgICB0cmFuc2NlaXZlciA9IHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSB8fFxuICAgICAgICAgICAgcGMuX2NyZWF0ZVRyYW5zY2VpdmVyKGtpbmQpO1xuICAgICAgICB0cmFuc2NlaXZlci5taWQgPSBtaWQ7XG5cbiAgICAgICAgaWYgKCF0cmFuc2NlaXZlci5pY2VHYXRoZXJlcikge1xuICAgICAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyID0gcGMuX2NyZWF0ZUljZUdhdGhlcmVyKHNkcE1MaW5lSW5kZXgsXG4gICAgICAgICAgICAgIHVzaW5nQnVuZGxlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjYW5kcy5sZW5ndGggJiYgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgIGlmIChpc0NvbXBsZXRlICYmICghdXNpbmdCdW5kbGUgfHwgc2RwTUxpbmVJbmRleCA9PT0gMCkpIHtcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zZXRSZW1vdGVDYW5kaWRhdGVzKGNhbmRzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FuZHMuZm9yRWFjaChmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgICAgICAgICAgICAgbWF5YmVBZGRDYW5kaWRhdGUodHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LCBjYW5kaWRhdGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbG9jYWxDYXBhYmlsaXRpZXMgPSB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIuZ2V0Q2FwYWJpbGl0aWVzKGtpbmQpO1xuXG4gICAgICAgIC8vIGZpbHRlciBSVFggdW50aWwgYWRkaXRpb25hbCBzdHVmZiBuZWVkZWQgZm9yIFJUWCBpcyBpbXBsZW1lbnRlZFxuICAgICAgICAvLyBpbiBhZGFwdGVyLmpzXG4gICAgICAgIGlmIChlZGdlVmVyc2lvbiA8IDE1MDE5KSB7XG4gICAgICAgICAgbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzID0gbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzLmZpbHRlcihcbiAgICAgICAgICAgICAgZnVuY3Rpb24oY29kZWMpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29kZWMubmFtZSAhPT0gJ3J0eCc7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VuZEVuY29kaW5nUGFyYW1ldGVycyA9IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgfHwgW3tcbiAgICAgICAgICBzc3JjOiAoMiAqIHNkcE1MaW5lSW5kZXggKyAyKSAqIDEwMDFcbiAgICAgICAgfV07XG5cbiAgICAgICAgLy8gVE9ETzogcmV3cml0ZSB0byB1c2UgaHR0cDovL3czYy5naXRodWIuaW8vd2VicnRjLXBjLyNzZXQtYXNzb2NpYXRlZC1yZW1vdGUtc3RyZWFtc1xuICAgICAgICB2YXIgaXNOZXdUcmFjayA9IGZhbHNlO1xuICAgICAgICBpZiAoZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnIHx8IGRpcmVjdGlvbiA9PT0gJ3NlbmRvbmx5Jykge1xuICAgICAgICAgIGlzTmV3VHJhY2sgPSAhdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgICAgICAgcnRwUmVjZWl2ZXIgPSB0cmFuc2NlaXZlci5ydHBSZWNlaXZlciB8fFxuICAgICAgICAgICAgICBuZXcgd2luZG93LlJUQ1J0cFJlY2VpdmVyKHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQsIGtpbmQpO1xuXG4gICAgICAgICAgaWYgKGlzTmV3VHJhY2spIHtcbiAgICAgICAgICAgIHZhciBzdHJlYW07XG4gICAgICAgICAgICB0cmFjayA9IHJ0cFJlY2VpdmVyLnRyYWNrO1xuICAgICAgICAgICAgLy8gRklYTUU6IGRvZXMgbm90IHdvcmsgd2l0aCBQbGFuIEIuXG4gICAgICAgICAgICBpZiAocmVtb3RlTXNpZCAmJiByZW1vdGVNc2lkLnN0cmVhbSA9PT0gJy0nKSB7XG4gICAgICAgICAgICAgIC8vIG5vLW9wLiBhIHN0cmVhbSBpZCBvZiAnLScgbWVhbnM6IG5vIGFzc29jaWF0ZWQgc3RyZWFtLlxuICAgICAgICAgICAgfSBlbHNlIGlmIChyZW1vdGVNc2lkKSB7XG4gICAgICAgICAgICAgIGlmICghc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0pIHtcbiAgICAgICAgICAgICAgICBzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oKTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0sICdpZCcsIHtcbiAgICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZW1vdGVNc2lkLnN0cmVhbTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodHJhY2ssICdpZCcsIHtcbiAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlbW90ZU1zaWQudHJhY2s7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgc3RyZWFtID0gc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpZiAoIXN0cmVhbXMuZGVmYXVsdCkge1xuICAgICAgICAgICAgICAgIHN0cmVhbXMuZGVmYXVsdCA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBzdHJlYW0gPSBzdHJlYW1zLmRlZmF1bHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3RyZWFtKSB7XG4gICAgICAgICAgICAgIGFkZFRyYWNrVG9TdHJlYW1BbmRGaXJlRXZlbnQodHJhY2ssIHN0cmVhbSk7XG4gICAgICAgICAgICAgIHRyYW5zY2VpdmVyLmFzc29jaWF0ZWRSZW1vdGVNZWRpYVN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVjZWl2ZXJMaXN0LnB1c2goW3RyYWNrLCBydHBSZWNlaXZlciwgc3RyZWFtXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyICYmIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyLnRyYWNrKSB7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIuYXNzb2NpYXRlZFJlbW90ZU1lZGlhU3RyZWFtcy5mb3JFYWNoKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgICAgIHZhciBuYXRpdmVUcmFjayA9IHMuZ2V0VHJhY2tzKCkuZmluZChmdW5jdGlvbih0KSB7XG4gICAgICAgICAgICAgIHJldHVybiB0LmlkID09PSB0cmFuc2NlaXZlci5ydHBSZWNlaXZlci50cmFjay5pZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKG5hdGl2ZVRyYWNrKSB7XG4gICAgICAgICAgICAgIHJlbW92ZVRyYWNrRnJvbVN0cmVhbUFuZEZpcmVFdmVudChuYXRpdmVUcmFjaywgcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIuYXNzb2NpYXRlZFJlbW90ZU1lZGlhU3RyZWFtcyA9IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXMgPSBsb2NhbENhcGFiaWxpdGllcztcbiAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzID0gcmVtb3RlQ2FwYWJpbGl0aWVzO1xuICAgICAgICB0cmFuc2NlaXZlci5ydHBSZWNlaXZlciA9IHJ0cFJlY2VpdmVyO1xuICAgICAgICB0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycyA9IHJ0Y3BQYXJhbWV0ZXJzO1xuICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzID0gc2VuZEVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgICAgdHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVycyA9IHJlY3ZFbmNvZGluZ1BhcmFtZXRlcnM7XG5cbiAgICAgICAgLy8gU3RhcnQgdGhlIFJUQ1J0cFJlY2VpdmVyIG5vdy4gVGhlIFJUUFNlbmRlciBpcyBzdGFydGVkIGluXG4gICAgICAgIC8vIHNldExvY2FsRGVzY3JpcHRpb24uXG4gICAgICAgIHBjLl90cmFuc2NlaXZlKHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSxcbiAgICAgICAgICAgIGZhbHNlLFxuICAgICAgICAgICAgaXNOZXdUcmFjayk7XG4gICAgICB9IGVsc2UgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdhbnN3ZXInICYmICFyZWplY3RlZCkge1xuICAgICAgICB0cmFuc2NlaXZlciA9IHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XTtcbiAgICAgICAgaWNlR2F0aGVyZXIgPSB0cmFuc2NlaXZlci5pY2VHYXRoZXJlcjtcbiAgICAgICAgaWNlVHJhbnNwb3J0ID0gdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0O1xuICAgICAgICBkdGxzVHJhbnNwb3J0ID0gdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydDtcbiAgICAgICAgcnRwUmVjZWl2ZXIgPSB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICAgICAgc2VuZEVuY29kaW5nUGFyYW1ldGVycyA9IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzID0gdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXM7XG5cbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMgPVxuICAgICAgICAgICAgcmVjdkVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJlbW90ZUNhcGFiaWxpdGllcyA9XG4gICAgICAgICAgICByZW1vdGVDYXBhYmlsaXRpZXM7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5ydGNwUGFyYW1ldGVycyA9IHJ0Y3BQYXJhbWV0ZXJzO1xuXG4gICAgICAgIGlmIChjYW5kcy5sZW5ndGggJiYgaWNlVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgIGlmICgoaXNJY2VMaXRlIHx8IGlzQ29tcGxldGUpICYmXG4gICAgICAgICAgICAgICghdXNpbmdCdW5kbGUgfHwgc2RwTUxpbmVJbmRleCA9PT0gMCkpIHtcbiAgICAgICAgICAgIGljZVRyYW5zcG9ydC5zZXRSZW1vdGVDYW5kaWRhdGVzKGNhbmRzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FuZHMuZm9yRWFjaChmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgICAgICAgICAgICAgbWF5YmVBZGRDYW5kaWRhdGUodHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LCBjYW5kaWRhdGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF1c2luZ0J1bmRsZSB8fCBzZHBNTGluZUluZGV4ID09PSAwKSB7XG4gICAgICAgICAgaWYgKGljZVRyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICAgIGljZVRyYW5zcG9ydC5zdGFydChpY2VHYXRoZXJlciwgcmVtb3RlSWNlUGFyYW1ldGVycyxcbiAgICAgICAgICAgICAgICAnY29udHJvbGxpbmcnKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGR0bHNUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgICBkdGxzVHJhbnNwb3J0LnN0YXJ0KHJlbW90ZUR0bHNQYXJhbWV0ZXJzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBwYy5fdHJhbnNjZWl2ZSh0cmFuc2NlaXZlcixcbiAgICAgICAgICAgIGRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2JyB8fCBkaXJlY3Rpb24gPT09ICdyZWN2b25seScsXG4gICAgICAgICAgICBkaXJlY3Rpb24gPT09ICdzZW5kcmVjdicgfHwgZGlyZWN0aW9uID09PSAnc2VuZG9ubHknKTtcblxuICAgICAgICAvLyBUT0RPOiByZXdyaXRlIHRvIHVzZSBodHRwOi8vdzNjLmdpdGh1Yi5pby93ZWJydGMtcGMvI3NldC1hc3NvY2lhdGVkLXJlbW90ZS1zdHJlYW1zXG4gICAgICAgIGlmIChydHBSZWNlaXZlciAmJlxuICAgICAgICAgICAgKGRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2JyB8fCBkaXJlY3Rpb24gPT09ICdzZW5kb25seScpKSB7XG4gICAgICAgICAgdHJhY2sgPSBydHBSZWNlaXZlci50cmFjaztcbiAgICAgICAgICBpZiAocmVtb3RlTXNpZCkge1xuICAgICAgICAgICAgaWYgKCFzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSkge1xuICAgICAgICAgICAgICBzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFkZFRyYWNrVG9TdHJlYW1BbmRGaXJlRXZlbnQodHJhY2ssIHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dKTtcbiAgICAgICAgICAgIHJlY2VpdmVyTGlzdC5wdXNoKFt0cmFjaywgcnRwUmVjZWl2ZXIsIHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dXSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICghc3RyZWFtcy5kZWZhdWx0KSB7XG4gICAgICAgICAgICAgIHN0cmVhbXMuZGVmYXVsdCA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFkZFRyYWNrVG9TdHJlYW1BbmRGaXJlRXZlbnQodHJhY2ssIHN0cmVhbXMuZGVmYXVsdCk7XG4gICAgICAgICAgICByZWNlaXZlckxpc3QucHVzaChbdHJhY2ssIHJ0cFJlY2VpdmVyLCBzdHJlYW1zLmRlZmF1bHRdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRklYTUU6IGFjdHVhbGx5IHRoZSByZWNlaXZlciBzaG91bGQgYmUgY3JlYXRlZCBsYXRlci5cbiAgICAgICAgICBkZWxldGUgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChwYy5fZHRsc1JvbGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGMuX2R0bHNSb2xlID0gZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJyA/ICdhY3RpdmUnIDogJ3Bhc3NpdmUnO1xuICAgIH1cblxuICAgIHBjLl9yZW1vdGVEZXNjcmlwdGlvbiA9IHtcbiAgICAgIHR5cGU6IGRlc2NyaXB0aW9uLnR5cGUsXG4gICAgICBzZHA6IGRlc2NyaXB0aW9uLnNkcFxuICAgIH07XG4gICAgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicpIHtcbiAgICAgIHBjLl91cGRhdGVTaWduYWxpbmdTdGF0ZSgnaGF2ZS1yZW1vdGUtb2ZmZXInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcGMuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlKCdzdGFibGUnKTtcbiAgICB9XG4gICAgT2JqZWN0LmtleXMoc3RyZWFtcykuZm9yRWFjaChmdW5jdGlvbihzaWQpIHtcbiAgICAgIHZhciBzdHJlYW0gPSBzdHJlYW1zW3NpZF07XG4gICAgICBpZiAoc3RyZWFtLmdldFRyYWNrcygpLmxlbmd0aCkge1xuICAgICAgICBpZiAocGMucmVtb3RlU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPT09IC0xKSB7XG4gICAgICAgICAgcGMucmVtb3RlU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdhZGRzdHJlYW0nKTtcbiAgICAgICAgICBldmVudC5zdHJlYW0gPSBzdHJlYW07XG4gICAgICAgICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBwYy5fZGlzcGF0Y2hFdmVudCgnYWRkc3RyZWFtJywgZXZlbnQpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVjZWl2ZXJMaXN0LmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuICAgICAgICAgIHZhciB0cmFjayA9IGl0ZW1bMF07XG4gICAgICAgICAgdmFyIHJlY2VpdmVyID0gaXRlbVsxXTtcbiAgICAgICAgICBpZiAoc3RyZWFtLmlkICE9PSBpdGVtWzJdLmlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGZpcmVBZGRUcmFjayhwYywgdHJhY2ssIHJlY2VpdmVyLCBbc3RyZWFtXSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJlY2VpdmVyTGlzdC5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgIGlmIChpdGVtWzJdKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGZpcmVBZGRUcmFjayhwYywgaXRlbVswXSwgaXRlbVsxXSwgW10pO1xuICAgIH0pO1xuXG4gICAgLy8gY2hlY2sgd2hldGhlciBhZGRJY2VDYW5kaWRhdGUoe30pIHdhcyBjYWxsZWQgd2l0aGluIGZvdXIgc2Vjb25kcyBhZnRlclxuICAgIC8vIHNldFJlbW90ZURlc2NyaXB0aW9uLlxuICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCEocGMgJiYgcGMudHJhbnNjZWl2ZXJzKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgICBpZiAodHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0ICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuZ2V0UmVtb3RlQ2FuZGlkYXRlcygpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ1RpbWVvdXQgZm9yIGFkZFJlbW90ZUNhbmRpZGF0ZS4gQ29uc2lkZXIgc2VuZGluZyAnICtcbiAgICAgICAgICAgICAgJ2FuIGVuZC1vZi1jYW5kaWRhdGVzIG5vdGlmaWNhdGlvbicpO1xuICAgICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5hZGRSZW1vdGVDYW5kaWRhdGUoe30pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LCA0MDAwKTtcblxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAvKiBub3QgeWV0XG4gICAgICBpZiAodHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuY2xvc2UoKTtcbiAgICAgIH1cbiAgICAgICovXG4gICAgICBpZiAodHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0KSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zdG9wKCk7XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCkge1xuICAgICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LnN0b3AoKTtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnN0b3AoKTtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5ydHBSZWNlaXZlcikge1xuICAgICAgICB0cmFuc2NlaXZlci5ydHBSZWNlaXZlci5zdG9wKCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gRklYTUU6IGNsZWFuIHVwIHRyYWNrcywgbG9jYWwgc3RyZWFtcywgcmVtb3RlIHN0cmVhbXMsIGV0Y1xuICAgIHRoaXMuX2lzQ2xvc2VkID0gdHJ1ZTtcbiAgICB0aGlzLl91cGRhdGVTaWduYWxpbmdTdGF0ZSgnY2xvc2VkJyk7XG4gIH07XG5cbiAgLy8gVXBkYXRlIHRoZSBzaWduYWxpbmcgc3RhdGUuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fdXBkYXRlU2lnbmFsaW5nU3RhdGUgPSBmdW5jdGlvbihuZXdTdGF0ZSkge1xuICAgIHRoaXMuc2lnbmFsaW5nU3RhdGUgPSBuZXdTdGF0ZTtcbiAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ3NpZ25hbGluZ3N0YXRlY2hhbmdlJyk7XG4gICAgdGhpcy5fZGlzcGF0Y2hFdmVudCgnc2lnbmFsaW5nc3RhdGVjaGFuZ2UnLCBldmVudCk7XG4gIH07XG5cbiAgLy8gRGV0ZXJtaW5lIHdoZXRoZXIgdG8gZmlyZSB0aGUgbmVnb3RpYXRpb25uZWVkZWQgZXZlbnQuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fbWF5YmVGaXJlTmVnb3RpYXRpb25OZWVkZWQgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIGlmICh0aGlzLnNpZ25hbGluZ1N0YXRlICE9PSAnc3RhYmxlJyB8fCB0aGlzLm5lZWROZWdvdGlhdGlvbiA9PT0gdHJ1ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLm5lZWROZWdvdGlhdGlvbiA9IHRydWU7XG4gICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBpZiAocGMubmVlZE5lZ290aWF0aW9uKSB7XG4gICAgICAgIHBjLm5lZWROZWdvdGlhdGlvbiA9IGZhbHNlO1xuICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ25lZ290aWF0aW9ubmVlZGVkJyk7XG4gICAgICAgIHBjLl9kaXNwYXRjaEV2ZW50KCduZWdvdGlhdGlvbm5lZWRlZCcsIGV2ZW50KTtcbiAgICAgIH1cbiAgICB9LCAwKTtcbiAgfTtcblxuICAvLyBVcGRhdGUgdGhlIGljZSBjb25uZWN0aW9uIHN0YXRlLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZUljZUNvbm5lY3Rpb25TdGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuZXdTdGF0ZTtcbiAgICB2YXIgc3RhdGVzID0ge1xuICAgICAgJ25ldyc6IDAsXG4gICAgICBjbG9zZWQ6IDAsXG4gICAgICBjaGVja2luZzogMCxcbiAgICAgIGNvbm5lY3RlZDogMCxcbiAgICAgIGNvbXBsZXRlZDogMCxcbiAgICAgIGRpc2Nvbm5lY3RlZDogMCxcbiAgICAgIGZhaWxlZDogMFxuICAgIH07XG4gICAgdGhpcy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgc3RhdGVzW3RyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zdGF0ZV0rKztcbiAgICB9KTtcblxuICAgIG5ld1N0YXRlID0gJ25ldyc7XG4gICAgaWYgKHN0YXRlcy5mYWlsZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdmYWlsZWQnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmNoZWNraW5nID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnY2hlY2tpbmcnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmRpc2Nvbm5lY3RlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMubmV3ID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnbmV3JztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5jb25uZWN0ZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdjb25uZWN0ZWQnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmNvbXBsZXRlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2NvbXBsZXRlZCc7XG4gICAgfVxuXG4gICAgaWYgKG5ld1N0YXRlICE9PSB0aGlzLmljZUNvbm5lY3Rpb25TdGF0ZSkge1xuICAgICAgdGhpcy5pY2VDb25uZWN0aW9uU3RhdGUgPSBuZXdTdGF0ZTtcbiAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlJyk7XG4gICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50KCdpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2UnLCBldmVudCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIFVwZGF0ZSB0aGUgY29ubmVjdGlvbiBzdGF0ZS5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl91cGRhdGVDb25uZWN0aW9uU3RhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbmV3U3RhdGU7XG4gICAgdmFyIHN0YXRlcyA9IHtcbiAgICAgICduZXcnOiAwLFxuICAgICAgY2xvc2VkOiAwLFxuICAgICAgY29ubmVjdGluZzogMCxcbiAgICAgIGNvbm5lY3RlZDogMCxcbiAgICAgIGNvbXBsZXRlZDogMCxcbiAgICAgIGRpc2Nvbm5lY3RlZDogMCxcbiAgICAgIGZhaWxlZDogMFxuICAgIH07XG4gICAgdGhpcy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgc3RhdGVzW3RyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zdGF0ZV0rKztcbiAgICAgIHN0YXRlc1t0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LnN0YXRlXSsrO1xuICAgIH0pO1xuICAgIC8vIElDRVRyYW5zcG9ydC5jb21wbGV0ZWQgYW5kIGNvbm5lY3RlZCBhcmUgdGhlIHNhbWUgZm9yIHRoaXMgcHVycG9zZS5cbiAgICBzdGF0ZXMuY29ubmVjdGVkICs9IHN0YXRlcy5jb21wbGV0ZWQ7XG5cbiAgICBuZXdTdGF0ZSA9ICduZXcnO1xuICAgIGlmIChzdGF0ZXMuZmFpbGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnZmFpbGVkJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5jb25uZWN0aW5nID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnY29ubmVjdGluZyc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuZGlzY29ubmVjdGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnZGlzY29ubmVjdGVkJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5uZXcgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICduZXcnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmNvbm5lY3RlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2Nvbm5lY3RlZCc7XG4gICAgfVxuXG4gICAgaWYgKG5ld1N0YXRlICE9PSB0aGlzLmNvbm5lY3Rpb25TdGF0ZSkge1xuICAgICAgdGhpcy5jb25uZWN0aW9uU3RhdGUgPSBuZXdTdGF0ZTtcbiAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnY29ubmVjdGlvbnN0YXRlY2hhbmdlJyk7XG4gICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50KCdjb25uZWN0aW9uc3RhdGVjaGFuZ2UnLCBldmVudCk7XG4gICAgfVxuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVPZmZlciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwYyA9IHRoaXM7XG5cbiAgICBpZiAocGMuX2lzQ2xvc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0NhbiBub3QgY2FsbCBjcmVhdGVPZmZlciBhZnRlciBjbG9zZScpKTtcbiAgICB9XG5cbiAgICB2YXIgbnVtQXVkaW9UcmFja3MgPSBwYy50cmFuc2NlaXZlcnMuZmlsdGVyKGZ1bmN0aW9uKHQpIHtcbiAgICAgIHJldHVybiB0LmtpbmQgPT09ICdhdWRpbyc7XG4gICAgfSkubGVuZ3RoO1xuICAgIHZhciBudW1WaWRlb1RyYWNrcyA9IHBjLnRyYW5zY2VpdmVycy5maWx0ZXIoZnVuY3Rpb24odCkge1xuICAgICAgcmV0dXJuIHQua2luZCA9PT0gJ3ZpZGVvJztcbiAgICB9KS5sZW5ndGg7XG5cbiAgICAvLyBEZXRlcm1pbmUgbnVtYmVyIG9mIGF1ZGlvIGFuZCB2aWRlbyB0cmFja3Mgd2UgbmVlZCB0byBzZW5kL3JlY3YuXG4gICAgdmFyIG9mZmVyT3B0aW9ucyA9IGFyZ3VtZW50c1swXTtcbiAgICBpZiAob2ZmZXJPcHRpb25zKSB7XG4gICAgICAvLyBSZWplY3QgQ2hyb21lIGxlZ2FjeSBjb25zdHJhaW50cy5cbiAgICAgIGlmIChvZmZlck9wdGlvbnMubWFuZGF0b3J5IHx8IG9mZmVyT3B0aW9ucy5vcHRpb25hbCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgICAgJ0xlZ2FjeSBtYW5kYXRvcnkvb3B0aW9uYWwgY29uc3RyYWludHMgbm90IHN1cHBvcnRlZC4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyA9PT0gdHJ1ZSkge1xuICAgICAgICAgIG51bUF1ZGlvVHJhY2tzID0gMTtcbiAgICAgICAgfSBlbHNlIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyA9PT0gZmFsc2UpIHtcbiAgICAgICAgICBudW1BdWRpb1RyYWNrcyA9IDA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbnVtQXVkaW9UcmFja3MgPSBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID09PSB0cnVlKSB7XG4gICAgICAgICAgbnVtVmlkZW9UcmFja3MgPSAxO1xuICAgICAgICB9IGVsc2UgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID09PSBmYWxzZSkge1xuICAgICAgICAgIG51bVZpZGVvVHJhY2tzID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBudW1WaWRlb1RyYWNrcyA9IG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgIG51bUF1ZGlvVHJhY2tzLS07XG4gICAgICAgIGlmIChudW1BdWRpb1RyYWNrcyA8IDApIHtcbiAgICAgICAgICB0cmFuc2NlaXZlci53YW50UmVjZWl2ZSA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgbnVtVmlkZW9UcmFja3MtLTtcbiAgICAgICAgaWYgKG51bVZpZGVvVHJhY2tzIDwgMCkge1xuICAgICAgICAgIHRyYW5zY2VpdmVyLndhbnRSZWNlaXZlID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBNLWxpbmVzIGZvciByZWN2b25seSBzdHJlYW1zLlxuICAgIHdoaWxlIChudW1BdWRpb1RyYWNrcyA+IDAgfHwgbnVtVmlkZW9UcmFja3MgPiAwKSB7XG4gICAgICBpZiAobnVtQXVkaW9UcmFja3MgPiAwKSB7XG4gICAgICAgIHBjLl9jcmVhdGVUcmFuc2NlaXZlcignYXVkaW8nKTtcbiAgICAgICAgbnVtQXVkaW9UcmFja3MtLTtcbiAgICAgIH1cbiAgICAgIGlmIChudW1WaWRlb1RyYWNrcyA+IDApIHtcbiAgICAgICAgcGMuX2NyZWF0ZVRyYW5zY2VpdmVyKCd2aWRlbycpO1xuICAgICAgICBudW1WaWRlb1RyYWNrcy0tO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBzZHAgPSBTRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZShwYy5fc2RwU2Vzc2lvbklkLFxuICAgICAgICBwYy5fc2RwU2Vzc2lvblZlcnNpb24rKyk7XG4gICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIsIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgIC8vIEZvciBlYWNoIHRyYWNrLCBjcmVhdGUgYW4gaWNlIGdhdGhlcmVyLCBpY2UgdHJhbnNwb3J0LFxuICAgICAgLy8gZHRscyB0cmFuc3BvcnQsIHBvdGVudGlhbGx5IHJ0cHNlbmRlciBhbmQgcnRwcmVjZWl2ZXIuXG4gICAgICB2YXIgdHJhY2sgPSB0cmFuc2NlaXZlci50cmFjaztcbiAgICAgIHZhciBraW5kID0gdHJhbnNjZWl2ZXIua2luZDtcbiAgICAgIHZhciBtaWQgPSB0cmFuc2NlaXZlci5taWQgfHwgU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG4gICAgICB0cmFuc2NlaXZlci5taWQgPSBtaWQ7XG5cbiAgICAgIGlmICghdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIgPSBwYy5fY3JlYXRlSWNlR2F0aGVyZXIoc2RwTUxpbmVJbmRleCxcbiAgICAgICAgICAgIHBjLnVzaW5nQnVuZGxlKTtcbiAgICAgIH1cblxuICAgICAgdmFyIGxvY2FsQ2FwYWJpbGl0aWVzID0gd2luZG93LlJUQ1J0cFNlbmRlci5nZXRDYXBhYmlsaXRpZXMoa2luZCk7XG4gICAgICAvLyBmaWx0ZXIgUlRYIHVudGlsIGFkZGl0aW9uYWwgc3R1ZmYgbmVlZGVkIGZvciBSVFggaXMgaW1wbGVtZW50ZWRcbiAgICAgIC8vIGluIGFkYXB0ZXIuanNcbiAgICAgIGlmIChlZGdlVmVyc2lvbiA8IDE1MDE5KSB7XG4gICAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcyA9IGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcy5maWx0ZXIoXG4gICAgICAgICAgICBmdW5jdGlvbihjb2RlYykge1xuICAgICAgICAgICAgICByZXR1cm4gY29kZWMubmFtZSAhPT0gJ3J0eCc7XG4gICAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgICAgIC8vIHdvcmsgYXJvdW5kIGh0dHBzOi8vYnVncy5jaHJvbWl1bS5vcmcvcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD02NTUyXG4gICAgICAgIC8vIGJ5IGFkZGluZyBsZXZlbC1hc3ltbWV0cnktYWxsb3dlZD0xXG4gICAgICAgIGlmIChjb2RlYy5uYW1lID09PSAnSDI2NCcgJiZcbiAgICAgICAgICAgIGNvZGVjLnBhcmFtZXRlcnNbJ2xldmVsLWFzeW1tZXRyeS1hbGxvd2VkJ10gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNvZGVjLnBhcmFtZXRlcnNbJ2xldmVsLWFzeW1tZXRyeS1hbGxvd2VkJ10gPSAnMSc7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBmb3Igc3Vic2VxdWVudCBvZmZlcnMsIHdlIG1pZ2h0IGhhdmUgdG8gcmUtdXNlIHRoZSBwYXlsb2FkXG4gICAgICAgIC8vIHR5cGUgb2YgdGhlIGxhc3Qgb2ZmZXIuXG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcy5jb2RlY3MpIHtcbiAgICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMuY29kZWNzLmZvckVhY2goZnVuY3Rpb24ocmVtb3RlQ29kZWMpIHtcbiAgICAgICAgICAgIGlmIChjb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IHJlbW90ZUNvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSAmJlxuICAgICAgICAgICAgICAgIGNvZGVjLmNsb2NrUmF0ZSA9PT0gcmVtb3RlQ29kZWMuY2xvY2tSYXRlKSB7XG4gICAgICAgICAgICAgIGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlID0gcmVtb3RlQ29kZWMucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgbG9jYWxDYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKGhkckV4dCkge1xuICAgICAgICB2YXIgcmVtb3RlRXh0ZW5zaW9ucyA9IHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcyAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnMgfHwgW107XG4gICAgICAgIHJlbW90ZUV4dGVuc2lvbnMuZm9yRWFjaChmdW5jdGlvbihySGRyRXh0KSB7XG4gICAgICAgICAgaWYgKGhkckV4dC51cmkgPT09IHJIZHJFeHQudXJpKSB7XG4gICAgICAgICAgICBoZHJFeHQuaWQgPSBySGRyRXh0LmlkO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gZ2VuZXJhdGUgYW4gc3NyYyBub3csIHRvIGJlIHVzZWQgbGF0ZXIgaW4gcnRwU2VuZGVyLnNlbmRcbiAgICAgIHZhciBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzID0gdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycyB8fCBbe1xuICAgICAgICBzc3JjOiAoMiAqIHNkcE1MaW5lSW5kZXggKyAxKSAqIDEwMDFcbiAgICAgIH1dO1xuICAgICAgaWYgKHRyYWNrKSB7XG4gICAgICAgIC8vIGFkZCBSVFhcbiAgICAgICAgaWYgKGVkZ2VWZXJzaW9uID49IDE1MDE5ICYmIGtpbmQgPT09ICd2aWRlbycgJiZcbiAgICAgICAgICAgICFzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgICAgICAgIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4ID0ge1xuICAgICAgICAgICAgc3NyYzogc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICsgMVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRyYW5zY2VpdmVyLndhbnRSZWNlaXZlKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyID0gbmV3IHdpbmRvdy5SVENSdHBSZWNlaXZlcihcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQsIGtpbmQpO1xuICAgICAgfVxuXG4gICAgICB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcyA9IGxvY2FsQ2FwYWJpbGl0aWVzO1xuICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycyA9IHNlbmRFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgfSk7XG5cbiAgICAvLyBhbHdheXMgb2ZmZXIgQlVORExFIGFuZCBkaXNwb3NlIG9uIHJldHVybiBpZiBub3Qgc3VwcG9ydGVkLlxuICAgIGlmIChwYy5fY29uZmlnLmJ1bmRsZVBvbGljeSAhPT0gJ21heC1jb21wYXQnKSB7XG4gICAgICBzZHAgKz0gJ2E9Z3JvdXA6QlVORExFICcgKyBwYy50cmFuc2NlaXZlcnMubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgcmV0dXJuIHQubWlkO1xuICAgICAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG4gICAgfVxuICAgIHNkcCArPSAnYT1pY2Utb3B0aW9uczp0cmlja2xlXFxyXFxuJztcblxuICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICBzZHAgKz0gd3JpdGVNZWRpYVNlY3Rpb24odHJhbnNjZWl2ZXIsIHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzLFxuICAgICAgICAgICdvZmZlcicsIHRyYW5zY2VpdmVyLnN0cmVhbSwgcGMuX2R0bHNSb2xlKTtcbiAgICAgIHNkcCArPSAnYT1ydGNwLXJzaXplXFxyXFxuJztcblxuICAgICAgaWYgKHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyICYmIHBjLmljZUdhdGhlcmluZ1N0YXRlICE9PSAnbmV3JyAmJlxuICAgICAgICAgIChzZHBNTGluZUluZGV4ID09PSAwIHx8ICFwYy51c2luZ0J1bmRsZSkpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuZ2V0TG9jYWxDYW5kaWRhdGVzKCkuZm9yRWFjaChmdW5jdGlvbihjYW5kKSB7XG4gICAgICAgICAgY2FuZC5jb21wb25lbnQgPSAxO1xuICAgICAgICAgIHNkcCArPSAnYT0nICsgU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUoY2FuZCkgKyAnXFxyXFxuJztcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLnN0YXRlID09PSAnY29tcGxldGVkJykge1xuICAgICAgICAgIHNkcCArPSAnYT1lbmQtb2YtY2FuZGlkYXRlc1xcclxcbic7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHZhciBkZXNjID0gbmV3IHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24oe1xuICAgICAgdHlwZTogJ29mZmVyJyxcbiAgICAgIHNkcDogc2RwXG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShkZXNjKTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlQW5zd2VyID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBjID0gdGhpcztcblxuICAgIGlmIChwYy5faXNDbG9zZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQ2FuIG5vdCBjYWxsIGNyZWF0ZUFuc3dlciBhZnRlciBjbG9zZScpKTtcbiAgICB9XG5cbiAgICBpZiAoIShwYy5zaWduYWxpbmdTdGF0ZSA9PT0gJ2hhdmUtcmVtb3RlLW9mZmVyJyB8fFxuICAgICAgICBwYy5zaWduYWxpbmdTdGF0ZSA9PT0gJ2hhdmUtbG9jYWwtcHJhbnN3ZXInKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdDYW4gbm90IGNhbGwgY3JlYXRlQW5zd2VyIGluIHNpZ25hbGluZ1N0YXRlICcgKyBwYy5zaWduYWxpbmdTdGF0ZSkpO1xuICAgIH1cblxuICAgIHZhciBzZHAgPSBTRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZShwYy5fc2RwU2Vzc2lvbklkLFxuICAgICAgICBwYy5fc2RwU2Vzc2lvblZlcnNpb24rKyk7XG4gICAgaWYgKHBjLnVzaW5nQnVuZGxlKSB7XG4gICAgICBzZHAgKz0gJ2E9Z3JvdXA6QlVORExFICcgKyBwYy50cmFuc2NlaXZlcnMubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgcmV0dXJuIHQubWlkO1xuICAgICAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG4gICAgfVxuICAgIHZhciBtZWRpYVNlY3Rpb25zSW5PZmZlciA9IFNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMoXG4gICAgICAgIHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApLmxlbmd0aDtcbiAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlciwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgaWYgKHNkcE1MaW5lSW5kZXggKyAxID4gbWVkaWFTZWN0aW9uc0luT2ZmZXIpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJlamVjdGVkKSB7XG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAnYXBwbGljYXRpb24nKSB7XG4gICAgICAgICAgc2RwICs9ICdtPWFwcGxpY2F0aW9uIDAgRFRMUy9TQ1RQIDUwMDBcXHJcXG4nO1xuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICBzZHAgKz0gJ209YXVkaW8gMCBVRFAvVExTL1JUUC9TQVZQRiAwXFxyXFxuJyArXG4gICAgICAgICAgICAgICdhPXJ0cG1hcDowIFBDTVUvODAwMFxcclxcbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgIHNkcCArPSAnbT12aWRlbyAwIFVEUC9UTFMvUlRQL1NBVlBGIDEyMFxcclxcbicgK1xuICAgICAgICAgICAgICAnYT1ydHBtYXA6MTIwIFZQOC85MDAwMFxcclxcbic7XG4gICAgICAgIH1cbiAgICAgICAgc2RwICs9ICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJyArXG4gICAgICAgICAgICAnYT1pbmFjdGl2ZVxcclxcbicgK1xuICAgICAgICAgICAgJ2E9bWlkOicgKyB0cmFuc2NlaXZlci5taWQgKyAnXFxyXFxuJztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBGSVhNRTogbG9vayBhdCBkaXJlY3Rpb24uXG4gICAgICBpZiAodHJhbnNjZWl2ZXIuc3RyZWFtKSB7XG4gICAgICAgIHZhciBsb2NhbFRyYWNrO1xuICAgICAgICBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgIGxvY2FsVHJhY2sgPSB0cmFuc2NlaXZlci5zdHJlYW0uZ2V0QXVkaW9UcmFja3MoKVswXTtcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgICAgbG9jYWxUcmFjayA9IHRyYW5zY2VpdmVyLnN0cmVhbS5nZXRWaWRlb1RyYWNrcygpWzBdO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NhbFRyYWNrKSB7XG4gICAgICAgICAgLy8gYWRkIFJUWFxuICAgICAgICAgIGlmIChlZGdlVmVyc2lvbiA+PSAxNTAxOSAmJiB0cmFuc2NlaXZlci5raW5kID09PSAndmlkZW8nICYmXG4gICAgICAgICAgICAgICF0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHggPSB7XG4gICAgICAgICAgICAgIHNzcmM6IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArIDFcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIENhbGN1bGF0ZSBpbnRlcnNlY3Rpb24gb2YgY2FwYWJpbGl0aWVzLlxuICAgICAgdmFyIGNvbW1vbkNhcGFiaWxpdGllcyA9IGdldENvbW1vbkNhcGFiaWxpdGllcyhcbiAgICAgICAgICB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcyxcbiAgICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMpO1xuXG4gICAgICB2YXIgaGFzUnR4ID0gY29tbW9uQ2FwYWJpbGl0aWVzLmNvZGVjcy5maWx0ZXIoZnVuY3Rpb24oYykge1xuICAgICAgICByZXR1cm4gYy5uYW1lLnRvTG93ZXJDYXNlKCkgPT09ICdydHgnO1xuICAgICAgfSkubGVuZ3RoO1xuICAgICAgaWYgKCFoYXNSdHggJiYgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICAgICAgZGVsZXRlIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4O1xuICAgICAgfVxuXG4gICAgICBzZHAgKz0gd3JpdGVNZWRpYVNlY3Rpb24odHJhbnNjZWl2ZXIsIGNvbW1vbkNhcGFiaWxpdGllcyxcbiAgICAgICAgICAnYW5zd2VyJywgdHJhbnNjZWl2ZXIuc3RyZWFtLCBwYy5fZHRsc1JvbGUpO1xuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzICYmXG4gICAgICAgICAgdHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUpIHtcbiAgICAgICAgc2RwICs9ICdhPXJ0Y3AtcnNpemVcXHJcXG4nO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdmFyIGRlc2MgPSBuZXcgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbih7XG4gICAgICB0eXBlOiAnYW5zd2VyJyxcbiAgICAgIHNkcDogc2RwXG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShkZXNjKTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICB2YXIgc2VjdGlvbnM7XG4gICAgaWYgKGNhbmRpZGF0ZSAmJiAhKGNhbmRpZGF0ZS5zZHBNTGluZUluZGV4ICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgY2FuZGlkYXRlLnNkcE1pZCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgVHlwZUVycm9yKCdzZHBNTGluZUluZGV4IG9yIHNkcE1pZCByZXF1aXJlZCcpKTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBuZWVkcyB0byBnbyBpbnRvIG9wcyBxdWV1ZS5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZiAoIXBjLl9yZW1vdGVEZXNjcmlwdGlvbikge1xuICAgICAgICByZXR1cm4gcmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICAgJ0NhbiBub3QgYWRkIElDRSBjYW5kaWRhdGUgd2l0aG91dCBhIHJlbW90ZSBkZXNjcmlwdGlvbicpKTtcbiAgICAgIH0gZWxzZSBpZiAoIWNhbmRpZGF0ZSB8fCBjYW5kaWRhdGUuY2FuZGlkYXRlID09PSAnJykge1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHBjLnRyYW5zY2VpdmVycy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChwYy50cmFuc2NlaXZlcnNbal0ucmVqZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbal0uaWNlVHJhbnNwb3J0LmFkZFJlbW90ZUNhbmRpZGF0ZSh7fSk7XG4gICAgICAgICAgc2VjdGlvbnMgPSBTRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zKHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApO1xuICAgICAgICAgIHNlY3Rpb25zW2pdICs9ICdhPWVuZC1vZi1jYW5kaWRhdGVzXFxyXFxuJztcbiAgICAgICAgICBwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwID1cbiAgICAgICAgICAgICAgU0RQVXRpbHMuZ2V0RGVzY3JpcHRpb24ocGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCkgK1xuICAgICAgICAgICAgICBzZWN0aW9ucy5qb2luKCcnKTtcbiAgICAgICAgICBpZiAocGMudXNpbmdCdW5kbGUpIHtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHNkcE1MaW5lSW5kZXggPSBjYW5kaWRhdGUuc2RwTUxpbmVJbmRleDtcbiAgICAgICAgaWYgKGNhbmRpZGF0ZS5zZHBNaWQpIHtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBjLnRyYW5zY2VpdmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKHBjLnRyYW5zY2VpdmVyc1tpXS5taWQgPT09IGNhbmRpZGF0ZS5zZHBNaWQpIHtcbiAgICAgICAgICAgICAgc2RwTUxpbmVJbmRleCA9IGk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB2YXIgdHJhbnNjZWl2ZXIgPSBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF07XG4gICAgICAgIGlmICh0cmFuc2NlaXZlcikge1xuICAgICAgICAgIGlmICh0cmFuc2NlaXZlci5yZWplY3RlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdmFyIGNhbmQgPSBPYmplY3Qua2V5cyhjYW5kaWRhdGUuY2FuZGlkYXRlKS5sZW5ndGggPiAwID9cbiAgICAgICAgICAgICAgU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUoY2FuZGlkYXRlLmNhbmRpZGF0ZSkgOiB7fTtcbiAgICAgICAgICAvLyBJZ25vcmUgQ2hyb21lJ3MgaW52YWxpZCBjYW5kaWRhdGVzIHNpbmNlIEVkZ2UgZG9lcyBub3QgbGlrZSB0aGVtLlxuICAgICAgICAgIGlmIChjYW5kLnByb3RvY29sID09PSAndGNwJyAmJiAoY2FuZC5wb3J0ID09PSAwIHx8IGNhbmQucG9ydCA9PT0gOSkpIHtcbiAgICAgICAgICAgIHJldHVybiByZXNvbHZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIElnbm9yZSBSVENQIGNhbmRpZGF0ZXMsIHdlIGFzc3VtZSBSVENQLU1VWC5cbiAgICAgICAgICBpZiAoY2FuZC5jb21wb25lbnQgJiYgY2FuZC5jb21wb25lbnQgIT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiByZXNvbHZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIHdoZW4gdXNpbmcgYnVuZGxlLCBhdm9pZCBhZGRpbmcgY2FuZGlkYXRlcyB0byB0aGUgd3JvbmdcbiAgICAgICAgICAvLyBpY2UgdHJhbnNwb3J0LiBBbmQgYXZvaWQgYWRkaW5nIGNhbmRpZGF0ZXMgYWRkZWQgaW4gdGhlIFNEUC5cbiAgICAgICAgICBpZiAoc2RwTUxpbmVJbmRleCA9PT0gMCB8fCAoc2RwTUxpbmVJbmRleCA+IDAgJiZcbiAgICAgICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0ICE9PSBwYy50cmFuc2NlaXZlcnNbMF0uaWNlVHJhbnNwb3J0KSkge1xuICAgICAgICAgICAgaWYgKCFtYXliZUFkZENhbmRpZGF0ZSh0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQsIGNhbmQpKSB7XG4gICAgICAgICAgICAgIHJldHVybiByZWplY3QobWFrZUVycm9yKCdPcGVyYXRpb25FcnJvcicsXG4gICAgICAgICAgICAgICAgICAnQ2FuIG5vdCBhZGQgSUNFIGNhbmRpZGF0ZScpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyB1cGRhdGUgdGhlIHJlbW90ZURlc2NyaXB0aW9uLlxuICAgICAgICAgIHZhciBjYW5kaWRhdGVTdHJpbmcgPSBjYW5kaWRhdGUuY2FuZGlkYXRlLnRyaW0oKTtcbiAgICAgICAgICBpZiAoY2FuZGlkYXRlU3RyaW5nLmluZGV4T2YoJ2E9JykgPT09IDApIHtcbiAgICAgICAgICAgIGNhbmRpZGF0ZVN0cmluZyA9IGNhbmRpZGF0ZVN0cmluZy5zdWJzdHIoMik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlY3Rpb25zID0gU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyhwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKTtcbiAgICAgICAgICBzZWN0aW9uc1tzZHBNTGluZUluZGV4XSArPSAnYT0nICtcbiAgICAgICAgICAgICAgKGNhbmQudHlwZSA/IGNhbmRpZGF0ZVN0cmluZyA6ICdlbmQtb2YtY2FuZGlkYXRlcycpXG4gICAgICAgICAgICAgICsgJ1xcclxcbic7XG4gICAgICAgICAgcGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCA9XG4gICAgICAgICAgICAgIFNEUFV0aWxzLmdldERlc2NyaXB0aW9uKHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApICtcbiAgICAgICAgICAgICAgc2VjdGlvbnMuam9pbignJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChtYWtlRXJyb3IoJ09wZXJhdGlvbkVycm9yJyxcbiAgICAgICAgICAgICAgJ0NhbiBub3QgYWRkIElDRSBjYW5kaWRhdGUnKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJlc29sdmUoKTtcbiAgICB9KTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbihzZWxlY3Rvcikge1xuICAgIGlmIChzZWxlY3RvciAmJiBzZWxlY3RvciBpbnN0YW5jZW9mIHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrKSB7XG4gICAgICB2YXIgc2VuZGVyT3JSZWNlaXZlciA9IG51bGw7XG4gICAgICB0aGlzLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci50cmFjayA9PT0gc2VsZWN0b3IpIHtcbiAgICAgICAgICBzZW5kZXJPclJlY2VpdmVyID0gdHJhbnNjZWl2ZXIucnRwU2VuZGVyO1xuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5ydHBSZWNlaXZlci50cmFjayA9PT0gc2VsZWN0b3IpIHtcbiAgICAgICAgICBzZW5kZXJPclJlY2VpdmVyID0gdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKCFzZW5kZXJPclJlY2VpdmVyKSB7XG4gICAgICAgIHRocm93IG1ha2VFcnJvcignSW52YWxpZEFjY2Vzc0Vycm9yJywgJ0ludmFsaWQgc2VsZWN0b3IuJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VuZGVyT3JSZWNlaXZlci5nZXRTdGF0cygpO1xuICAgIH1cblxuICAgIHZhciBwcm9taXNlcyA9IFtdO1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIFsncnRwU2VuZGVyJywgJ3J0cFJlY2VpdmVyJywgJ2ljZUdhdGhlcmVyJywgJ2ljZVRyYW5zcG9ydCcsXG4gICAgICAgICAgJ2R0bHNUcmFuc3BvcnQnXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICAgICAgaWYgKHRyYW5zY2VpdmVyW21ldGhvZF0pIHtcbiAgICAgICAgICAgICAgcHJvbWlzZXMucHVzaCh0cmFuc2NlaXZlclttZXRob2RdLmdldFN0YXRzKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcykudGhlbihmdW5jdGlvbihhbGxTdGF0cykge1xuICAgICAgdmFyIHJlc3VsdHMgPSBuZXcgTWFwKCk7XG4gICAgICBhbGxTdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHN0YXRzKSB7XG4gICAgICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24oc3RhdCkge1xuICAgICAgICAgIHJlc3VsdHMuc2V0KHN0YXQuaWQsIHN0YXQpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgfSk7XG4gIH07XG5cbiAgLy8gZml4IGxvdy1sZXZlbCBzdGF0IG5hbWVzIGFuZCByZXR1cm4gTWFwIGluc3RlYWQgb2Ygb2JqZWN0LlxuICB2YXIgb3J0Y09iamVjdHMgPSBbJ1JUQ1J0cFNlbmRlcicsICdSVENSdHBSZWNlaXZlcicsICdSVENJY2VHYXRoZXJlcicsXG4gICAgJ1JUQ0ljZVRyYW5zcG9ydCcsICdSVENEdGxzVHJhbnNwb3J0J107XG4gIG9ydGNPYmplY3RzLmZvckVhY2goZnVuY3Rpb24ob3J0Y09iamVjdE5hbWUpIHtcbiAgICB2YXIgb2JqID0gd2luZG93W29ydGNPYmplY3ROYW1lXTtcbiAgICBpZiAob2JqICYmIG9iai5wcm90b3R5cGUgJiYgb2JqLnByb3RvdHlwZS5nZXRTdGF0cykge1xuICAgICAgdmFyIG5hdGl2ZUdldHN0YXRzID0gb2JqLnByb3RvdHlwZS5nZXRTdGF0cztcbiAgICAgIG9iai5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5hdGl2ZUdldHN0YXRzLmFwcGx5KHRoaXMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKG5hdGl2ZVN0YXRzKSB7XG4gICAgICAgICAgdmFyIG1hcFN0YXRzID0gbmV3IE1hcCgpO1xuICAgICAgICAgIE9iamVjdC5rZXlzKG5hdGl2ZVN0YXRzKS5mb3JFYWNoKGZ1bmN0aW9uKGlkKSB7XG4gICAgICAgICAgICBuYXRpdmVTdGF0c1tpZF0udHlwZSA9IGZpeFN0YXRzVHlwZShuYXRpdmVTdGF0c1tpZF0pO1xuICAgICAgICAgICAgbWFwU3RhdHMuc2V0KGlkLCBuYXRpdmVTdGF0c1tpZF0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBtYXBTdGF0cztcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gbGVnYWN5IGNhbGxiYWNrIHNoaW1zLiBTaG91bGQgYmUgbW92ZWQgdG8gYWRhcHRlci5qcyBzb21lIGRheXMuXG4gIHZhciBtZXRob2RzID0gWydjcmVhdGVPZmZlcicsICdjcmVhdGVBbnN3ZXInXTtcbiAgbWV0aG9kcy5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgIHZhciBuYXRpdmVNZXRob2QgPSBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICBpZiAodHlwZW9mIGFyZ3NbMF0gPT09ICdmdW5jdGlvbicgfHxcbiAgICAgICAgICB0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJykgeyAvLyBsZWdhY3lcbiAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBbYXJndW1lbnRzWzJdXSlcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMF0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGFyZ3NbMF0uYXBwbHkobnVsbCwgW2Rlc2NyaXB0aW9uXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9LCBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgYXJnc1sxXS5hcHBseShudWxsLCBbZXJyb3JdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0pO1xuXG4gIG1ldGhvZHMgPSBbJ3NldExvY2FsRGVzY3JpcHRpb24nLCAnc2V0UmVtb3RlRGVzY3JpcHRpb24nLCAnYWRkSWNlQ2FuZGlkYXRlJ107XG4gIG1ldGhvZHMuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICB2YXIgbmF0aXZlTWV0aG9kID0gUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nIHx8XG4gICAgICAgICAgdHlwZW9mIGFyZ3NbMl0gPT09ICdmdW5jdGlvbicpIHsgLy8gbGVnYWN5XG4gICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGFyZ3NbMV0uYXBwbHkobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9LCBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0eXBlb2YgYXJnc1syXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgYXJnc1syXS5hcHBseShudWxsLCBbZXJyb3JdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0pO1xuXG4gIC8vIGdldFN0YXRzIGlzIHNwZWNpYWwuIEl0IGRvZXNuJ3QgaGF2ZSBhIHNwZWMgbGVnYWN5IG1ldGhvZCB5ZXQgd2Ugc3VwcG9ydFxuICAvLyBnZXRTdGF0cyhzb21ldGhpbmcsIGNiKSB3aXRob3V0IGVycm9yIGNhbGxiYWNrcy5cbiAgWydnZXRTdGF0cyddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgdmFyIG5hdGl2ZU1ldGhvZCA9IFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIGlmICh0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBhcmdzWzFdLmFwcGx5KG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSk7XG5cbiAgcmV0dXJuIFJUQ1BlZXJDb25uZWN0aW9uO1xufTtcbiIsIiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxuLy8gU0RQIGhlbHBlcnMuXG52YXIgU0RQVXRpbHMgPSB7fTtcblxuLy8gR2VuZXJhdGUgYW4gYWxwaGFudW1lcmljIGlkZW50aWZpZXIgZm9yIGNuYW1lIG9yIG1pZHMuXG4vLyBUT0RPOiB1c2UgVVVJRHMgaW5zdGVhZD8gaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vamVkLzk4Mjg4M1xuU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgMTApO1xufTtcblxuLy8gVGhlIFJUQ1AgQ05BTUUgdXNlZCBieSBhbGwgcGVlcmNvbm5lY3Rpb25zIGZyb20gdGhlIHNhbWUgSlMuXG5TRFBVdGlscy5sb2NhbENOYW1lID0gU0RQVXRpbHMuZ2VuZXJhdGVJZGVudGlmaWVyKCk7XG5cbi8vIFNwbGl0cyBTRFAgaW50byBsaW5lcywgZGVhbGluZyB3aXRoIGJvdGggQ1JMRiBhbmQgTEYuXG5TRFBVdGlscy5zcGxpdExpbmVzID0gZnVuY3Rpb24oYmxvYikge1xuICByZXR1cm4gYmxvYi50cmltKCkuc3BsaXQoJ1xcbicpLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgcmV0dXJuIGxpbmUudHJpbSgpO1xuICB9KTtcbn07XG4vLyBTcGxpdHMgU0RQIGludG8gc2Vzc2lvbnBhcnQgYW5kIG1lZGlhc2VjdGlvbnMuIEVuc3VyZXMgQ1JMRi5cblNEUFV0aWxzLnNwbGl0U2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIHZhciBwYXJ0cyA9IGJsb2Iuc3BsaXQoJ1xcbm09Jyk7XG4gIHJldHVybiBwYXJ0cy5tYXAoZnVuY3Rpb24ocGFydCwgaW5kZXgpIHtcbiAgICByZXR1cm4gKGluZGV4ID4gMCA/ICdtPScgKyBwYXJ0IDogcGFydCkudHJpbSgpICsgJ1xcclxcbic7XG4gIH0pO1xufTtcblxuLy8gcmV0dXJucyB0aGUgc2Vzc2lvbiBkZXNjcmlwdGlvbi5cblNEUFV0aWxzLmdldERlc2NyaXB0aW9uID0gZnVuY3Rpb24oYmxvYikge1xuICB2YXIgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICByZXR1cm4gc2VjdGlvbnMgJiYgc2VjdGlvbnNbMF07XG59O1xuXG4vLyByZXR1cm5zIHRoZSBpbmRpdmlkdWFsIG1lZGlhIHNlY3Rpb25zLlxuU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgdmFyIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhibG9iKTtcbiAgc2VjdGlvbnMuc2hpZnQoKTtcbiAgcmV0dXJuIHNlY3Rpb25zO1xufTtcblxuLy8gUmV0dXJucyBsaW5lcyB0aGF0IHN0YXJ0IHdpdGggYSBjZXJ0YWluIHByZWZpeC5cblNEUFV0aWxzLm1hdGNoUHJlZml4ID0gZnVuY3Rpb24oYmxvYiwgcHJlZml4KSB7XG4gIHJldHVybiBTRFBVdGlscy5zcGxpdExpbmVzKGJsb2IpLmZpbHRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgcmV0dXJuIGxpbmUuaW5kZXhPZihwcmVmaXgpID09PSAwO1xuICB9KTtcbn07XG5cbi8vIFBhcnNlcyBhbiBJQ0UgY2FuZGlkYXRlIGxpbmUuIFNhbXBsZSBpbnB1dDpcbi8vIGNhbmRpZGF0ZTo3MDI3ODYzNTAgMiB1ZHAgNDE4MTk5MDIgOC44LjguOCA2MDc2OSB0eXAgcmVsYXkgcmFkZHIgOC44LjguOFxuLy8gcnBvcnQgNTU5OTZcIlxuU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJ0cztcbiAgLy8gUGFyc2UgYm90aCB2YXJpYW50cy5cbiAgaWYgKGxpbmUuaW5kZXhPZignYT1jYW5kaWRhdGU6JykgPT09IDApIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEyKS5zcGxpdCgnICcpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTApLnNwbGl0KCcgJyk7XG4gIH1cblxuICB2YXIgY2FuZGlkYXRlID0ge1xuICAgIGZvdW5kYXRpb246IHBhcnRzWzBdLFxuICAgIGNvbXBvbmVudDogcGFyc2VJbnQocGFydHNbMV0sIDEwKSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0udG9Mb3dlckNhc2UoKSxcbiAgICBwcmlvcml0eTogcGFyc2VJbnQocGFydHNbM10sIDEwKSxcbiAgICBpcDogcGFydHNbNF0sXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbNV0sIDEwKSxcbiAgICAvLyBza2lwIHBhcnRzWzZdID09ICd0eXAnXG4gICAgdHlwZTogcGFydHNbN11cbiAgfTtcblxuICBmb3IgKHZhciBpID0gODsgaSA8IHBhcnRzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgc3dpdGNoIChwYXJ0c1tpXSkge1xuICAgICAgY2FzZSAncmFkZHInOlxuICAgICAgICBjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncnBvcnQnOlxuICAgICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQgPSBwYXJzZUludChwYXJ0c1tpICsgMV0sIDEwKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0Y3B0eXBlJzpcbiAgICAgICAgY2FuZGlkYXRlLnRjcFR5cGUgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndWZyYWcnOlxuICAgICAgICBjYW5kaWRhdGUudWZyYWcgPSBwYXJ0c1tpICsgMV07IC8vIGZvciBiYWNrd2FyZCBjb21wYWJpbGl0eS5cbiAgICAgICAgY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDogLy8gZXh0ZW5zaW9uIGhhbmRsaW5nLCBpbiBwYXJ0aWN1bGFyIHVmcmFnXG4gICAgICAgIGNhbmRpZGF0ZVtwYXJ0c1tpXV0gPSBwYXJ0c1tpICsgMV07XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufTtcblxuLy8gVHJhbnNsYXRlcyBhIGNhbmRpZGF0ZSBvYmplY3QgaW50byBTRFAgY2FuZGlkYXRlIGF0dHJpYnV0ZS5cblNEUFV0aWxzLndyaXRlQ2FuZGlkYXRlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHZhciBzZHAgPSBbXTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLmZvdW5kYXRpb24pO1xuICBzZHAucHVzaChjYW5kaWRhdGUuY29tcG9uZW50KTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLnByb3RvY29sLnRvVXBwZXJDYXNlKCkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUucHJpb3JpdHkpO1xuICBzZHAucHVzaChjYW5kaWRhdGUuaXApO1xuICBzZHAucHVzaChjYW5kaWRhdGUucG9ydCk7XG5cbiAgdmFyIHR5cGUgPSBjYW5kaWRhdGUudHlwZTtcbiAgc2RwLnB1c2goJ3R5cCcpO1xuICBzZHAucHVzaCh0eXBlKTtcbiAgaWYgKHR5cGUgIT09ICdob3N0JyAmJiBjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MgJiZcbiAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCkge1xuICAgIHNkcC5wdXNoKCdyYWRkcicpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyk7XG4gICAgc2RwLnB1c2goJ3Jwb3J0Jyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnRjcFR5cGUgJiYgY2FuZGlkYXRlLnByb3RvY29sLnRvTG93ZXJDYXNlKCkgPT09ICd0Y3AnKSB7XG4gICAgc2RwLnB1c2goJ3RjcHR5cGUnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudGNwVHlwZSk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZykge1xuICAgIHNkcC5wdXNoKCd1ZnJhZycpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50IHx8IGNhbmRpZGF0ZS51ZnJhZyk7XG4gIH1cbiAgcmV0dXJuICdjYW5kaWRhdGU6JyArIHNkcC5qb2luKCcgJyk7XG59O1xuXG4vLyBQYXJzZXMgYW4gaWNlLW9wdGlvbnMgbGluZSwgcmV0dXJucyBhbiBhcnJheSBvZiBvcHRpb24gdGFncy5cbi8vIGE9aWNlLW9wdGlvbnM6Zm9vIGJhclxuU0RQVXRpbHMucGFyc2VJY2VPcHRpb25zID0gZnVuY3Rpb24obGluZSkge1xuICByZXR1cm4gbGluZS5zdWJzdHIoMTQpLnNwbGl0KCcgJyk7XG59XG5cbi8vIFBhcnNlcyBhbiBydHBtYXAgbGluZSwgcmV0dXJucyBSVENSdHBDb2RkZWNQYXJhbWV0ZXJzLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0cG1hcDoxMTEgb3B1cy80ODAwMC8yXG5TRFBVdGlscy5wYXJzZVJ0cE1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIoOSkuc3BsaXQoJyAnKTtcbiAgdmFyIHBhcnNlZCA9IHtcbiAgICBwYXlsb2FkVHlwZTogcGFyc2VJbnQocGFydHMuc2hpZnQoKSwgMTApIC8vIHdhczogaWRcbiAgfTtcblxuICBwYXJ0cyA9IHBhcnRzWzBdLnNwbGl0KCcvJyk7XG5cbiAgcGFyc2VkLm5hbWUgPSBwYXJ0c1swXTtcbiAgcGFyc2VkLmNsb2NrUmF0ZSA9IHBhcnNlSW50KHBhcnRzWzFdLCAxMCk7IC8vIHdhczogY2xvY2tyYXRlXG4gIHBhcnNlZC5jaGFubmVscyA9IHBhcnRzLmxlbmd0aCA9PT0gMyA/IHBhcnNlSW50KHBhcnRzWzJdLCAxMCkgOiAxO1xuICAvLyBsZWdhY3kgYWxpYXMsIGdvdCByZW5hbWVkIGJhY2sgdG8gY2hhbm5lbHMgaW4gT1JUQy5cbiAgcGFyc2VkLm51bUNoYW5uZWxzID0gcGFyc2VkLmNoYW5uZWxzO1xuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGUgYW4gYT1ydHBtYXAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvclxuLy8gUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBNYXAgPSBmdW5jdGlvbihjb2RlYykge1xuICB2YXIgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIHZhciBjaGFubmVscyA9IGNvZGVjLmNoYW5uZWxzIHx8IGNvZGVjLm51bUNoYW5uZWxzIHx8IDE7XG4gIHJldHVybiAnYT1ydHBtYXA6JyArIHB0ICsgJyAnICsgY29kZWMubmFtZSArICcvJyArIGNvZGVjLmNsb2NrUmF0ZSArXG4gICAgICAoY2hhbm5lbHMgIT09IDEgPyAnLycgKyBjaGFubmVscyA6ICcnKSArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGFuIGE9ZXh0bWFwIGxpbmUgKGhlYWRlcmV4dGVuc2lvbiBmcm9tIFJGQyA1Mjg1KS4gU2FtcGxlIGlucHV0OlxuLy8gYT1leHRtYXA6MiB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG4vLyBhPWV4dG1hcDoyL3NlbmRvbmx5IHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcblNEUFV0aWxzLnBhcnNlRXh0bWFwID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cig5KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGlkOiBwYXJzZUludChwYXJ0c1swXSwgMTApLFxuICAgIGRpcmVjdGlvbjogcGFydHNbMF0uaW5kZXhPZignLycpID4gMCA/IHBhcnRzWzBdLnNwbGl0KCcvJylbMV0gOiAnc2VuZHJlY3YnLFxuICAgIHVyaTogcGFydHNbMV1cbiAgfTtcbn07XG5cbi8vIEdlbmVyYXRlcyBhPWV4dG1hcCBsaW5lIGZyb20gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uUGFyYW1ldGVycyBvclxuLy8gUlRDUnRwSGVhZGVyRXh0ZW5zaW9uLlxuU0RQVXRpbHMud3JpdGVFeHRtYXAgPSBmdW5jdGlvbihoZWFkZXJFeHRlbnNpb24pIHtcbiAgcmV0dXJuICdhPWV4dG1hcDonICsgKGhlYWRlckV4dGVuc2lvbi5pZCB8fCBoZWFkZXJFeHRlbnNpb24ucHJlZmVycmVkSWQpICtcbiAgICAgIChoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICYmIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gIT09ICdzZW5kcmVjdidcbiAgICAgICAgICA/ICcvJyArIGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb25cbiAgICAgICAgICA6ICcnKSArXG4gICAgICAnICcgKyBoZWFkZXJFeHRlbnNpb24udXJpICsgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYW4gZnRtcCBsaW5lLCByZXR1cm5zIGRpY3Rpb25hcnkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9Zm10cDo5NiB2YnI9b247Y25nPW9uXG4vLyBBbHNvIGRlYWxzIHdpdGggdmJyPW9uOyBjbmc9b25cblNEUFV0aWxzLnBhcnNlRm10cCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnNlZCA9IHt9O1xuICB2YXIga3Y7XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJzsnKTtcbiAgZm9yICh2YXIgaiA9IDA7IGogPCBwYXJ0cy5sZW5ndGg7IGorKykge1xuICAgIGt2ID0gcGFydHNbal0udHJpbSgpLnNwbGl0KCc9Jyk7XG4gICAgcGFyc2VkW2t2WzBdLnRyaW0oKV0gPSBrdlsxXTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufTtcblxuLy8gR2VuZXJhdGVzIGFuIGE9ZnRtcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlRm10cCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIHZhciBsaW5lID0gJyc7XG4gIHZhciBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnBhcmFtZXRlcnMgJiYgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykubGVuZ3RoKSB7XG4gICAgdmFyIHBhcmFtcyA9IFtdO1xuICAgIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmZvckVhY2goZnVuY3Rpb24ocGFyYW0pIHtcbiAgICAgIGlmIChjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSkge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSArICc9JyArIGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBsaW5lICs9ICdhPWZtdHA6JyArIHB0ICsgJyAnICsgcGFyYW1zLmpvaW4oJzsnKSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBsaW5lO1xufTtcblxuLy8gUGFyc2VzIGFuIHJ0Y3AtZmIgbGluZSwgcmV0dXJucyBSVENQUnRjcEZlZWRiYWNrIG9iamVjdC4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydGNwLWZiOjk4IG5hY2sgcnBzaVxuU0RQVXRpbHMucGFyc2VSdGNwRmIgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKGxpbmUuaW5kZXhPZignICcpICsgMSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBwYXJ0cy5zaGlmdCgpLFxuICAgIHBhcmFtZXRlcjogcGFydHMuam9pbignICcpXG4gIH07XG59O1xuLy8gR2VuZXJhdGUgYT1ydGNwLWZiIGxpbmVzIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRjcEZiID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgdmFyIGxpbmVzID0gJyc7XG4gIHZhciBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgaWYgKGNvZGVjLnJ0Y3BGZWVkYmFjayAmJiBjb2RlYy5ydGNwRmVlZGJhY2subGVuZ3RoKSB7XG4gICAgLy8gRklYTUU6IHNwZWNpYWwgaGFuZGxpbmcgZm9yIHRyci1pbnQ/XG4gICAgY29kZWMucnRjcEZlZWRiYWNrLmZvckVhY2goZnVuY3Rpb24oZmIpIHtcbiAgICAgIGxpbmVzICs9ICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnICsgZmIudHlwZSArXG4gICAgICAoZmIucGFyYW1ldGVyICYmIGZiLnBhcmFtZXRlci5sZW5ndGggPyAnICcgKyBmYi5wYXJhbWV0ZXIgOiAnJykgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBsaW5lcztcbn07XG5cbi8vIFBhcnNlcyBhbiBSRkMgNTU3NiBzc3JjIG1lZGlhIGF0dHJpYnV0ZS4gU2FtcGxlIGlucHV0OlxuLy8gYT1zc3JjOjM3MzU5Mjg1NTkgY25hbWU6c29tZXRoaW5nXG5TRFBVdGlscy5wYXJzZVNzcmNNZWRpYSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHNwID0gbGluZS5pbmRleE9mKCcgJyk7XG4gIHZhciBwYXJ0cyA9IHtcbiAgICBzc3JjOiBwYXJzZUludChsaW5lLnN1YnN0cig3LCBzcCAtIDcpLCAxMClcbiAgfTtcbiAgdmFyIGNvbG9uID0gbGluZS5pbmRleE9mKCc6Jywgc3ApO1xuICBpZiAoY29sb24gPiAtMSkge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyKHNwICsgMSwgY29sb24gLSBzcCAtIDEpO1xuICAgIHBhcnRzLnZhbHVlID0gbGluZS5zdWJzdHIoY29sb24gKyAxKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cihzcCArIDEpO1xuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbi8vIEV4dHJhY3RzIHRoZSBNSUQgKFJGQyA1ODg4KSBmcm9tIGEgbWVkaWEgc2VjdGlvbi5cbi8vIHJldHVybnMgdGhlIE1JRCBvciB1bmRlZmluZWQgaWYgbm8gbWlkIGxpbmUgd2FzIGZvdW5kLlxuU0RQVXRpbHMuZ2V0TWlkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBtaWQgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1pZDonKVswXTtcbiAgaWYgKG1pZCkge1xuICAgIHJldHVybiBtaWQuc3Vic3RyKDYpO1xuICB9XG59XG5cblNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKDE0KS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGFsZ29yaXRobTogcGFydHNbMF0udG9Mb3dlckNhc2UoKSwgLy8gYWxnb3JpdGhtIGlzIGNhc2Utc2Vuc2l0aXZlIGluIEVkZ2UuXG4gICAgdmFsdWU6IHBhcnRzWzFdXG4gIH07XG59O1xuXG4vLyBFeHRyYWN0cyBEVExTIHBhcmFtZXRlcnMgZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGZpbmdlcnByaW50IGxpbmUgYXMgaW5wdXQuIFNlZSBhbHNvIGdldEljZVBhcmFtZXRlcnMuXG5TRFBVdGlscy5nZXREdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uICsgc2Vzc2lvbnBhcnQsXG4gICAgICAnYT1maW5nZXJwcmludDonKTtcbiAgLy8gTm90ZTogYT1zZXR1cCBsaW5lIGlzIGlnbm9yZWQgc2luY2Ugd2UgdXNlIHRoZSAnYXV0bycgcm9sZS5cbiAgLy8gTm90ZTI6ICdhbGdvcml0aG0nIGlzIG5vdCBjYXNlIHNlbnNpdGl2ZSBleGNlcHQgaW4gRWRnZS5cbiAgcmV0dXJuIHtcbiAgICByb2xlOiAnYXV0bycsXG4gICAgZmluZ2VycHJpbnRzOiBsaW5lcy5tYXAoU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludClcbiAgfTtcbn07XG5cbi8vIFNlcmlhbGl6ZXMgRFRMUyBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlRHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMsIHNldHVwVHlwZSkge1xuICB2YXIgc2RwID0gJ2E9c2V0dXA6JyArIHNldHVwVHlwZSArICdcXHJcXG4nO1xuICBwYXJhbXMuZmluZ2VycHJpbnRzLmZvckVhY2goZnVuY3Rpb24oZnApIHtcbiAgICBzZHAgKz0gJ2E9ZmluZ2VycHJpbnQ6JyArIGZwLmFsZ29yaXRobSArICcgJyArIGZwLnZhbHVlICsgJ1xcclxcbic7XG4gIH0pO1xuICByZXR1cm4gc2RwO1xufTtcbi8vIFBhcnNlcyBJQ0UgaW5mb3JtYXRpb24gZnJvbSBTRFAgbWVkaWEgc2VjdGlvbiBvciBzZXNzaW9ucGFydC5cbi8vIEZJWE1FOiBmb3IgY29uc2lzdGVuY3kgd2l0aCBvdGhlciBmdW5jdGlvbnMgdGhpcyBzaG91bGQgb25seVxuLy8gICBnZXQgdGhlIGljZS11ZnJhZyBhbmQgaWNlLXB3ZCBsaW5lcyBhcyBpbnB1dC5cblNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgLy8gU2VhcmNoIGluIHNlc3Npb24gcGFydCwgdG9vLlxuICBsaW5lcyA9IGxpbmVzLmNvbmNhdChTRFBVdGlscy5zcGxpdExpbmVzKHNlc3Npb25wYXJ0KSk7XG4gIHZhciBpY2VQYXJhbWV0ZXJzID0ge1xuICAgIHVzZXJuYW1lRnJhZ21lbnQ6IGxpbmVzLmZpbHRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgICByZXR1cm4gbGluZS5pbmRleE9mKCdhPWljZS11ZnJhZzonKSA9PT0gMDtcbiAgICB9KVswXS5zdWJzdHIoMTIpLFxuICAgIHBhc3N3b3JkOiBsaW5lcy5maWx0ZXIoZnVuY3Rpb24obGluZSkge1xuICAgICAgcmV0dXJuIGxpbmUuaW5kZXhPZignYT1pY2UtcHdkOicpID09PSAwO1xuICAgIH0pWzBdLnN1YnN0cigxMClcbiAgfTtcbiAgcmV0dXJuIGljZVBhcmFtZXRlcnM7XG59O1xuXG4vLyBTZXJpYWxpemVzIElDRSBwYXJhbWV0ZXJzIHRvIFNEUC5cblNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcykge1xuICByZXR1cm4gJ2E9aWNlLXVmcmFnOicgKyBwYXJhbXMudXNlcm5hbWVGcmFnbWVudCArICdcXHJcXG4nICtcbiAgICAgICdhPWljZS1wd2Q6JyArIHBhcmFtcy5wYXNzd29yZCArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBSVENSdHBQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBkZXNjcmlwdGlvbiA9IHtcbiAgICBjb2RlY3M6IFtdLFxuICAgIGhlYWRlckV4dGVuc2lvbnM6IFtdLFxuICAgIGZlY01lY2hhbmlzbXM6IFtdLFxuICAgIHJ0Y3A6IFtdXG4gIH07XG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgdmFyIG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgZm9yICh2YXIgaSA9IDM7IGkgPCBtbGluZS5sZW5ndGg7IGkrKykgeyAvLyBmaW5kIGFsbCBjb2RlY3MgZnJvbSBtbGluZVszLi5dXG4gICAgdmFyIHB0ID0gbWxpbmVbaV07XG4gICAgdmFyIHJ0cG1hcGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydHBtYXA6JyArIHB0ICsgJyAnKVswXTtcbiAgICBpZiAocnRwbWFwbGluZSkge1xuICAgICAgdmFyIGNvZGVjID0gU0RQVXRpbHMucGFyc2VSdHBNYXAocnRwbWFwbGluZSk7XG4gICAgICB2YXIgZm10cHMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgICBtZWRpYVNlY3Rpb24sICdhPWZtdHA6JyArIHB0ICsgJyAnKTtcbiAgICAgIC8vIE9ubHkgdGhlIGZpcnN0IGE9Zm10cDo8cHQ+IGlzIGNvbnNpZGVyZWQuXG4gICAgICBjb2RlYy5wYXJhbWV0ZXJzID0gZm10cHMubGVuZ3RoID8gU0RQVXRpbHMucGFyc2VGbXRwKGZtdHBzWzBdKSA6IHt9O1xuICAgICAgY29kZWMucnRjcEZlZWRiYWNrID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1ydGNwLWZiOicgKyBwdCArICcgJylcbiAgICAgICAgLm1hcChTRFBVdGlscy5wYXJzZVJ0Y3BGYik7XG4gICAgICBkZXNjcmlwdGlvbi5jb2RlY3MucHVzaChjb2RlYyk7XG4gICAgICAvLyBwYXJzZSBGRUMgbWVjaGFuaXNtcyBmcm9tIHJ0cG1hcCBsaW5lcy5cbiAgICAgIHN3aXRjaCAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKSB7XG4gICAgICAgIGNhc2UgJ1JFRCc6XG4gICAgICAgIGNhc2UgJ1VMUEZFQyc6XG4gICAgICAgICAgZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5wdXNoKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6IC8vIG9ubHkgUkVEIGFuZCBVTFBGRUMgYXJlIHJlY29nbml6ZWQgYXMgRkVDIG1lY2hhbmlzbXMuXG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9ZXh0bWFwOicpLmZvckVhY2goZnVuY3Rpb24obGluZSkge1xuICAgIGRlc2NyaXB0aW9uLmhlYWRlckV4dGVuc2lvbnMucHVzaChTRFBVdGlscy5wYXJzZUV4dG1hcChsaW5lKSk7XG4gIH0pO1xuICAvLyBGSVhNRTogcGFyc2UgcnRjcC5cbiAgcmV0dXJuIGRlc2NyaXB0aW9uO1xufTtcblxuLy8gR2VuZXJhdGVzIHBhcnRzIG9mIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBkZXNjcmliaW5nIHRoZSBjYXBhYmlsaXRpZXMgL1xuLy8gcGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24gPSBmdW5jdGlvbihraW5kLCBjYXBzKSB7XG4gIHZhciBzZHAgPSAnJztcblxuICAvLyBCdWlsZCB0aGUgbWxpbmUuXG4gIHNkcCArPSAnbT0nICsga2luZCArICcgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLmxlbmd0aCA+IDAgPyAnOScgOiAnMCc7IC8vIHJlamVjdCBpZiBubyBjb2RlY3MuXG4gIHNkcCArPSAnIFVEUC9UTFMvUlRQL1NBVlBGICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5tYXAoZnVuY3Rpb24oY29kZWMpIHtcbiAgICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICAgIH1cbiAgICByZXR1cm4gY29kZWMucGF5bG9hZFR5cGU7XG4gIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuXG4gIHNkcCArPSAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbic7XG4gIHNkcCArPSAnYT1ydGNwOjkgSU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuXG4gIC8vIEFkZCBhPXJ0cG1hcCBsaW5lcyBmb3IgZWFjaCBjb2RlYy4gQWxzbyBmbXRwIGFuZCBydGNwLWZiLlxuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRwTWFwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVGbXRwKGNvZGVjKTtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdGNwRmIoY29kZWMpO1xuICB9KTtcbiAgdmFyIG1heHB0aW1lID0gMDtcbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihjb2RlYykge1xuICAgIGlmIChjb2RlYy5tYXhwdGltZSA+IG1heHB0aW1lKSB7XG4gICAgICBtYXhwdGltZSA9IGNvZGVjLm1heHB0aW1lO1xuICAgIH1cbiAgfSk7XG4gIGlmIChtYXhwdGltZSA+IDApIHtcbiAgICBzZHAgKz0gJ2E9bWF4cHRpbWU6JyArIG1heHB0aW1lICsgJ1xcclxcbic7XG4gIH1cbiAgc2RwICs9ICdhPXJ0Y3AtbXV4XFxyXFxuJztcblxuICBpZiAoY2Fwcy5oZWFkZXJFeHRlbnNpb25zKSB7XG4gICAgY2Fwcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZnVuY3Rpb24oZXh0ZW5zaW9uKSB7XG4gICAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVFeHRtYXAoZXh0ZW5zaW9uKTtcbiAgICB9KTtcbiAgfVxuICAvLyBGSVhNRTogd3JpdGUgZmVjTWVjaGFuaXNtcy5cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgYW4gYXJyYXkgb2Zcbi8vIFJUQ1J0cEVuY29kaW5nUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwRW5jb2RpbmdQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBlbmNvZGluZ1BhcmFtZXRlcnMgPSBbXTtcbiAgdmFyIGRlc2NyaXB0aW9uID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gIHZhciBoYXNSZWQgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1JFRCcpICE9PSAtMTtcbiAgdmFyIGhhc1VscGZlYyA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignVUxQRkVDJykgIT09IC0xO1xuXG4gIC8vIGZpbHRlciBhPXNzcmM6Li4uIGNuYW1lOiwgaWdub3JlIFBsYW5CLW1zaWRcbiAgdmFyIHNzcmNzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gIC5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgIHJldHVybiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKTtcbiAgfSlcbiAgLmZpbHRlcihmdW5jdGlvbihwYXJ0cykge1xuICAgIHJldHVybiBwYXJ0cy5hdHRyaWJ1dGUgPT09ICdjbmFtZSc7XG4gIH0pO1xuICB2YXIgcHJpbWFyeVNzcmMgPSBzc3Jjcy5sZW5ndGggPiAwICYmIHNzcmNzWzBdLnNzcmM7XG4gIHZhciBzZWNvbmRhcnlTc3JjO1xuXG4gIHZhciBmbG93cyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYy1ncm91cDpGSUQnKVxuICAubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cigxNykuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4gcGFydHMubWFwKGZ1bmN0aW9uKHBhcnQpIHtcbiAgICAgIHJldHVybiBwYXJzZUludChwYXJ0LCAxMCk7XG4gICAgfSk7XG4gIH0pO1xuICBpZiAoZmxvd3MubGVuZ3RoID4gMCAmJiBmbG93c1swXS5sZW5ndGggPiAxICYmIGZsb3dzWzBdWzBdID09PSBwcmltYXJ5U3NyYykge1xuICAgIHNlY29uZGFyeVNzcmMgPSBmbG93c1swXVsxXTtcbiAgfVxuXG4gIGRlc2NyaXB0aW9uLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgaWYgKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSA9PT0gJ1JUWCcgJiYgY29kZWMucGFyYW1ldGVycy5hcHQpIHtcbiAgICAgIHZhciBlbmNQYXJhbSA9IHtcbiAgICAgICAgc3NyYzogcHJpbWFyeVNzcmMsXG4gICAgICAgIGNvZGVjUGF5bG9hZFR5cGU6IHBhcnNlSW50KGNvZGVjLnBhcmFtZXRlcnMuYXB0LCAxMCksXG4gICAgICB9O1xuICAgICAgaWYgKHByaW1hcnlTc3JjICYmIHNlY29uZGFyeVNzcmMpIHtcbiAgICAgICAgZW5jUGFyYW0ucnR4ID0ge3NzcmM6IHNlY29uZGFyeVNzcmN9O1xuICAgICAgfVxuICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgaWYgKGhhc1JlZCkge1xuICAgICAgICBlbmNQYXJhbSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZW5jUGFyYW0pKTtcbiAgICAgICAgZW5jUGFyYW0uZmVjID0ge1xuICAgICAgICAgIHNzcmM6IHNlY29uZGFyeVNzcmMsXG4gICAgICAgICAgbWVjaGFuaXNtOiBoYXNVbHBmZWMgPyAncmVkK3VscGZlYycgOiAncmVkJ1xuICAgICAgICB9O1xuICAgICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgaWYgKGVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGggPT09IDAgJiYgcHJpbWFyeVNzcmMpIHtcbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaCh7XG4gICAgICBzc3JjOiBwcmltYXJ5U3NyY1xuICAgIH0pO1xuICB9XG5cbiAgLy8gd2Ugc3VwcG9ydCBib3RoIGI9QVMgYW5kIGI9VElBUyBidXQgaW50ZXJwcmV0IEFTIGFzIFRJQVMuXG4gIHZhciBiYW5kd2lkdGggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdiPScpO1xuICBpZiAoYmFuZHdpZHRoLmxlbmd0aCkge1xuICAgIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1USUFTOicpID09PSAwKSB7XG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyKDcpLCAxMCk7XG4gICAgfSBlbHNlIGlmIChiYW5kd2lkdGhbMF0uaW5kZXhPZignYj1BUzonKSA9PT0gMCkge1xuICAgICAgLy8gdXNlIGZvcm11bGEgZnJvbSBKU0VQIHRvIGNvbnZlcnQgYj1BUyB0byBUSUFTIHZhbHVlLlxuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cig1KSwgMTApICogMTAwMCAqIDAuOTVcbiAgICAgICAgICAtICg1MCAqIDQwICogOCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJhbmR3aWR0aCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLmZvckVhY2goZnVuY3Rpb24ocGFyYW1zKSB7XG4gICAgICBwYXJhbXMubWF4Qml0cmF0ZSA9IGJhbmR3aWR0aDtcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gZW5jb2RpbmdQYXJhbWV0ZXJzO1xufTtcblxuLy8gcGFyc2VzIGh0dHA6Ly9kcmFmdC5vcnRjLm9yZy8jcnRjcnRjcHBhcmFtZXRlcnMqXG5TRFBVdGlscy5wYXJzZVJ0Y3BQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBydGNwUGFyYW1ldGVycyA9IHt9O1xuXG4gIHZhciBjbmFtZTtcbiAgLy8gR2V0cyB0aGUgZmlyc3QgU1NSQy4gTm90ZSB0aGF0IHdpdGggUlRYIHRoZXJlIG1pZ2h0IGJlIG11bHRpcGxlXG4gIC8vIFNTUkNzLlxuICB2YXIgcmVtb3RlU3NyYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAgICAgLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgIHJldHVybiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKTtcbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKGZ1bmN0aW9uKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJztcbiAgICAgIH0pWzBdO1xuICBpZiAocmVtb3RlU3NyYykge1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLmNuYW1lID0gcmVtb3RlU3NyYy52YWx1ZTtcbiAgICBydGNwUGFyYW1ldGVycy5zc3JjID0gcmVtb3RlU3NyYy5zc3JjO1xuICB9XG5cbiAgLy8gRWRnZSB1c2VzIHRoZSBjb21wb3VuZCBhdHRyaWJ1dGUgaW5zdGVhZCBvZiByZWR1Y2VkU2l6ZVxuICAvLyBjb21wb3VuZCBpcyAhcmVkdWNlZFNpemVcbiAgdmFyIHJzaXplID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLXJzaXplJyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplID0gcnNpemUubGVuZ3RoID4gMDtcbiAgcnRjcFBhcmFtZXRlcnMuY29tcG91bmQgPSByc2l6ZS5sZW5ndGggPT09IDA7XG5cbiAgLy8gcGFyc2VzIHRoZSBydGNwLW11eCBhdHRy0ZZidXRlLlxuICAvLyBOb3RlIHRoYXQgRWRnZSBkb2VzIG5vdCBzdXBwb3J0IHVubXV4ZWQgUlRDUC5cbiAgdmFyIG11eCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1tdXgnKTtcbiAgcnRjcFBhcmFtZXRlcnMubXV4ID0gbXV4Lmxlbmd0aCA+IDA7XG5cbiAgcmV0dXJuIHJ0Y3BQYXJhbWV0ZXJzO1xufTtcblxuLy8gcGFyc2VzIGVpdGhlciBhPW1zaWQ6IG9yIGE9c3NyYzouLi4gbXNpZCBsaW5lcyBhbmQgcmV0dXJuc1xuLy8gdGhlIGlkIG9mIHRoZSBNZWRpYVN0cmVhbSBhbmQgTWVkaWFTdHJlYW1UcmFjay5cblNEUFV0aWxzLnBhcnNlTXNpZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgcGFydHM7XG4gIHZhciBzcGVjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1tc2lkOicpO1xuICBpZiAoc3BlYy5sZW5ndGggPT09IDEpIHtcbiAgICBwYXJ0cyA9IHNwZWNbMF0uc3Vic3RyKDcpLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG4gIHZhciBwbGFuQiA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSk7XG4gIH0pXG4gIC5maWx0ZXIoZnVuY3Rpb24ocGFydHMpIHtcbiAgICByZXR1cm4gcGFydHMuYXR0cmlidXRlID09PSAnbXNpZCc7XG4gIH0pO1xuICBpZiAocGxhbkIubGVuZ3RoID4gMCkge1xuICAgIHBhcnRzID0gcGxhbkJbMF0udmFsdWUuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbn07XG5cbi8vIEdlbmVyYXRlIGEgc2Vzc2lvbiBJRCBmb3IgU0RQLlxuLy8gaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL2RyYWZ0LWlldGYtcnRjd2ViLWpzZXAtMjAjc2VjdGlvbi01LjIuMVxuLy8gcmVjb21tZW5kcyB1c2luZyBhIGNyeXB0b2dyYXBoaWNhbGx5IHJhbmRvbSArdmUgNjQtYml0IHZhbHVlXG4vLyBidXQgcmlnaHQgbm93IHRoaXMgc2hvdWxkIGJlIGFjY2VwdGFibGUgYW5kIHdpdGhpbiB0aGUgcmlnaHQgcmFuZ2VcblNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKCkuc3Vic3RyKDIsIDIxKTtcbn07XG5cbi8vIFdyaXRlIGJvaWxkZXIgcGxhdGUgZm9yIHN0YXJ0IG9mIFNEUFxuLy8gc2Vzc0lkIGFyZ3VtZW50IGlzIG9wdGlvbmFsIC0gaWYgbm90IHN1cHBsaWVkIGl0IHdpbGxcbi8vIGJlIGdlbmVyYXRlZCByYW5kb21seVxuLy8gc2Vzc1ZlcnNpb24gaXMgb3B0aW9uYWwgYW5kIGRlZmF1bHRzIHRvIDJcblNEUFV0aWxzLndyaXRlU2Vzc2lvbkJvaWxlcnBsYXRlID0gZnVuY3Rpb24oc2Vzc0lkLCBzZXNzVmVyKSB7XG4gIHZhciBzZXNzaW9uSWQ7XG4gIHZhciB2ZXJzaW9uID0gc2Vzc1ZlciAhPT0gdW5kZWZpbmVkID8gc2Vzc1ZlciA6IDI7XG4gIGlmIChzZXNzSWQpIHtcbiAgICBzZXNzaW9uSWQgPSBzZXNzSWQ7XG4gIH0gZWxzZSB7XG4gICAgc2Vzc2lvbklkID0gU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQoKTtcbiAgfVxuICAvLyBGSVhNRTogc2Vzcy1pZCBzaG91bGQgYmUgYW4gTlRQIHRpbWVzdGFtcC5cbiAgcmV0dXJuICd2PTBcXHJcXG4nICtcbiAgICAgICdvPXRoaXNpc2FkYXB0ZXJvcnRjICcgKyBzZXNzaW9uSWQgKyAnICcgKyB2ZXJzaW9uICsgJyBJTiBJUDQgMTI3LjAuMC4xXFxyXFxuJyArXG4gICAgICAncz0tXFxyXFxuJyArXG4gICAgICAndD0wIDBcXHJcXG4nO1xufTtcblxuU0RQVXRpbHMud3JpdGVNZWRpYVNlY3Rpb24gPSBmdW5jdGlvbih0cmFuc2NlaXZlciwgY2FwcywgdHlwZSwgc3RyZWFtKSB7XG4gIHZhciBzZHAgPSBTRFBVdGlscy53cml0ZVJ0cERlc2NyaXB0aW9uKHRyYW5zY2VpdmVyLmtpbmQsIGNhcHMpO1xuXG4gIC8vIE1hcCBJQ0UgcGFyYW1ldGVycyAodWZyYWcsIHB3ZCkgdG8gU0RQLlxuICBzZHAgKz0gU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzKFxuICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuZ2V0TG9jYWxQYXJhbWV0ZXJzKCkpO1xuXG4gIC8vIE1hcCBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuICBzZHAgKz0gU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyhcbiAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQuZ2V0TG9jYWxQYXJhbWV0ZXJzKCksXG4gICAgICB0eXBlID09PSAnb2ZmZXInID8gJ2FjdHBhc3MnIDogJ2FjdGl2ZScpO1xuXG4gIHNkcCArPSAnYT1taWQ6JyArIHRyYW5zY2VpdmVyLm1pZCArICdcXHJcXG4nO1xuXG4gIGlmICh0cmFuc2NlaXZlci5kaXJlY3Rpb24pIHtcbiAgICBzZHAgKz0gJ2E9JyArIHRyYW5zY2VpdmVyLmRpcmVjdGlvbiArICdcXHJcXG4nO1xuICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlciAmJiB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcikge1xuICAgIHNkcCArPSAnYT1zZW5kcmVjdlxcclxcbic7XG4gIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgc2RwICs9ICdhPXNlbmRvbmx5XFxyXFxuJztcbiAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBSZWNlaXZlcikge1xuICAgIHNkcCArPSAnYT1yZWN2b25seVxcclxcbic7XG4gIH0gZWxzZSB7XG4gICAgc2RwICs9ICdhPWluYWN0aXZlXFxyXFxuJztcbiAgfVxuXG4gIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICAvLyBzcGVjLlxuICAgIHZhciBtc2lkID0gJ21zaWQ6JyArIHN0cmVhbS5pZCArICcgJyArXG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci50cmFjay5pZCArICdcXHJcXG4nO1xuICAgIHNkcCArPSAnYT0nICsgbXNpZDtcblxuICAgIC8vIGZvciBDaHJvbWUuXG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArXG4gICAgICAgICcgJyArIG1zaWQ7XG4gICAgaWYgKHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICAgJyAnICsgbXNpZDtcbiAgICAgIHNkcCArPSAnYT1zc3JjLWdyb3VwOkZJRCAnICtcbiAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgKyAnICcgK1xuICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH1cbiAgfVxuICAvLyBGSVhNRTogdGhpcyBzaG91bGQgYmUgd3JpdHRlbiBieSB3cml0ZVJ0cERlc2NyaXB0aW9uLlxuICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICtcbiAgICAgICcgY25hbWU6JyArIFNEUFV0aWxzLmxvY2FsQ05hbWUgKyAnXFxyXFxuJztcbiAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlciAmJiB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgJyBjbmFtZTonICsgU0RQVXRpbHMubG9jYWxDTmFtZSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBHZXRzIHRoZSBkaXJlY3Rpb24gZnJvbSB0aGUgbWVkaWFTZWN0aW9uIG9yIHRoZSBzZXNzaW9ucGFydC5cblNEUFV0aWxzLmdldERpcmVjdGlvbiA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgLy8gTG9vayBmb3Igc2VuZHJlY3YsIHNlbmRvbmx5LCByZWN2b25seSwgaW5hY3RpdmUsIGRlZmF1bHQgdG8gc2VuZHJlY3YuXG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIHN3aXRjaCAobGluZXNbaV0pIHtcbiAgICAgIGNhc2UgJ2E9c2VuZHJlY3YnOlxuICAgICAgY2FzZSAnYT1zZW5kb25seSc6XG4gICAgICBjYXNlICdhPXJlY3Zvbmx5JzpcbiAgICAgIGNhc2UgJ2E9aW5hY3RpdmUnOlxuICAgICAgICByZXR1cm4gbGluZXNbaV0uc3Vic3RyKDIpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gRklYTUU6IFdoYXQgc2hvdWxkIGhhcHBlbiBoZXJlP1xuICAgIH1cbiAgfVxuICBpZiAoc2Vzc2lvbnBhcnQpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMuZ2V0RGlyZWN0aW9uKHNlc3Npb25wYXJ0KTtcbiAgfVxuICByZXR1cm4gJ3NlbmRyZWN2Jztcbn07XG5cblNEUFV0aWxzLmdldEtpbmQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICB2YXIgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICByZXR1cm4gbWxpbmVbMF0uc3Vic3RyKDIpO1xufTtcblxuU0RQVXRpbHMuaXNSZWplY3RlZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICByZXR1cm4gbWVkaWFTZWN0aW9uLnNwbGl0KCcgJywgMilbMV0gPT09ICcwJztcbn07XG5cblNEUFV0aWxzLnBhcnNlTUxpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICB2YXIgcGFydHMgPSBsaW5lc1swXS5zdWJzdHIoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBraW5kOiBwYXJ0c1swXSxcbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXSxcbiAgICBmbXQ6IHBhcnRzLnNsaWNlKDMpLmpvaW4oJyAnKVxuICB9O1xufTtcblxuU0RQVXRpbHMucGFyc2VPTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ289JylbMF07XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdXNlcm5hbWU6IHBhcnRzWzBdLFxuICAgIHNlc3Npb25JZDogcGFydHNbMV0sXG4gICAgc2Vzc2lvblZlcnNpb246IHBhcnNlSW50KHBhcnRzWzJdLCAxMCksXG4gICAgbmV0VHlwZTogcGFydHNbM10sXG4gICAgYWRkcmVzc1R5cGU6IHBhcnRzWzRdLFxuICAgIGFkZHJlc3M6IHBhcnRzWzVdLFxuICB9O1xufVxuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5pZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBTRFBVdGlscztcbn1cbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBhZGFwdGVyRmFjdG9yeSA9IHJlcXVpcmUoJy4vYWRhcHRlcl9mYWN0b3J5LmpzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IGFkYXB0ZXJGYWN0b3J5KHt3aW5kb3c6IGdsb2JhbC53aW5kb3d9KTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcbi8vIFNoaW1taW5nIHN0YXJ0cyBoZXJlLlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihkZXBlbmRlbmNpZXMsIG9wdHMpIHtcbiAgdmFyIHdpbmRvdyA9IGRlcGVuZGVuY2llcyAmJiBkZXBlbmRlbmNpZXMud2luZG93O1xuXG4gIHZhciBvcHRpb25zID0ge1xuICAgIHNoaW1DaHJvbWU6IHRydWUsXG4gICAgc2hpbUZpcmVmb3g6IHRydWUsXG4gICAgc2hpbUVkZ2U6IHRydWUsXG4gICAgc2hpbVNhZmFyaTogdHJ1ZSxcbiAgfTtcblxuICBmb3IgKHZhciBrZXkgaW4gb3B0cykge1xuICAgIGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKG9wdHMsIGtleSkpIHtcbiAgICAgIG9wdGlvbnNba2V5XSA9IG9wdHNba2V5XTtcbiAgICB9XG4gIH1cblxuICAvLyBVdGlscy5cbiAgdmFyIGxvZ2dpbmcgPSB1dGlscy5sb2c7XG4gIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcblxuICAvLyBVbmNvbW1lbnQgdGhlIGxpbmUgYmVsb3cgaWYgeW91IHdhbnQgbG9nZ2luZyB0byBvY2N1ciwgaW5jbHVkaW5nIGxvZ2dpbmdcbiAgLy8gZm9yIHRoZSBzd2l0Y2ggc3RhdGVtZW50IGJlbG93LiBDYW4gYWxzbyBiZSB0dXJuZWQgb24gaW4gdGhlIGJyb3dzZXIgdmlhXG4gIC8vIGFkYXB0ZXIuZGlzYWJsZUxvZyhmYWxzZSksIGJ1dCB0aGVuIGxvZ2dpbmcgZnJvbSB0aGUgc3dpdGNoIHN0YXRlbWVudCBiZWxvd1xuICAvLyB3aWxsIG5vdCBhcHBlYXIuXG4gIC8vIHJlcXVpcmUoJy4vdXRpbHMnKS5kaXNhYmxlTG9nKGZhbHNlKTtcblxuICAvLyBCcm93c2VyIHNoaW1zLlxuICB2YXIgY2hyb21lU2hpbSA9IHJlcXVpcmUoJy4vY2hyb21lL2Nocm9tZV9zaGltJykgfHwgbnVsbDtcbiAgdmFyIGVkZ2VTaGltID0gcmVxdWlyZSgnLi9lZGdlL2VkZ2Vfc2hpbScpIHx8IG51bGw7XG4gIHZhciBmaXJlZm94U2hpbSA9IHJlcXVpcmUoJy4vZmlyZWZveC9maXJlZm94X3NoaW0nKSB8fCBudWxsO1xuICB2YXIgc2FmYXJpU2hpbSA9IHJlcXVpcmUoJy4vc2FmYXJpL3NhZmFyaV9zaGltJykgfHwgbnVsbDtcbiAgdmFyIGNvbW1vblNoaW0gPSByZXF1aXJlKCcuL2NvbW1vbl9zaGltJykgfHwgbnVsbDtcblxuICAvLyBFeHBvcnQgdG8gdGhlIGFkYXB0ZXIgZ2xvYmFsIG9iamVjdCB2aXNpYmxlIGluIHRoZSBicm93c2VyLlxuICB2YXIgYWRhcHRlciA9IHtcbiAgICBicm93c2VyRGV0YWlsczogYnJvd3NlckRldGFpbHMsXG4gICAgY29tbW9uU2hpbTogY29tbW9uU2hpbSxcbiAgICBleHRyYWN0VmVyc2lvbjogdXRpbHMuZXh0cmFjdFZlcnNpb24sXG4gICAgZGlzYWJsZUxvZzogdXRpbHMuZGlzYWJsZUxvZyxcbiAgICBkaXNhYmxlV2FybmluZ3M6IHV0aWxzLmRpc2FibGVXYXJuaW5nc1xuICB9O1xuXG4gIC8vIFNoaW0gYnJvd3NlciBpZiBmb3VuZC5cbiAgc3dpdGNoIChicm93c2VyRGV0YWlscy5icm93c2VyKSB7XG4gICAgY2FzZSAnY2hyb21lJzpcbiAgICAgIGlmICghY2hyb21lU2hpbSB8fCAhY2hyb21lU2hpbS5zaGltUGVlckNvbm5lY3Rpb24gfHxcbiAgICAgICAgICAhb3B0aW9ucy5zaGltQ2hyb21lKSB7XG4gICAgICAgIGxvZ2dpbmcoJ0Nocm9tZSBzaGltIGlzIG5vdCBpbmNsdWRlZCBpbiB0aGlzIGFkYXB0ZXIgcmVsZWFzZS4nKTtcbiAgICAgICAgcmV0dXJuIGFkYXB0ZXI7XG4gICAgICB9XG4gICAgICBsb2dnaW5nKCdhZGFwdGVyLmpzIHNoaW1taW5nIGNocm9tZS4nKTtcbiAgICAgIC8vIEV4cG9ydCB0byB0aGUgYWRhcHRlciBnbG9iYWwgb2JqZWN0IHZpc2libGUgaW4gdGhlIGJyb3dzZXIuXG4gICAgICBhZGFwdGVyLmJyb3dzZXJTaGltID0gY2hyb21lU2hpbTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbUNyZWF0ZU9iamVjdFVSTCh3aW5kb3cpO1xuXG4gICAgICBjaHJvbWVTaGltLnNoaW1HZXRVc2VyTWVkaWEod2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbU1lZGlhU3RyZWFtKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1Tb3VyY2VPYmplY3Qod2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbVBlZXJDb25uZWN0aW9uKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1PblRyYWNrKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1BZGRUcmFja1JlbW92ZVRyYWNrKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1HZXRTZW5kZXJzV2l0aER0bWYod2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbVNlbmRlclJlY2VpdmVyR2V0U3RhdHMod2luZG93KTtcblxuICAgICAgY29tbW9uU2hpbS5zaGltUlRDSWNlQ2FuZGlkYXRlKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1NYXhNZXNzYWdlU2l6ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltU2VuZFRocm93VHlwZUVycm9yKHdpbmRvdyk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdmaXJlZm94JzpcbiAgICAgIGlmICghZmlyZWZveFNoaW0gfHwgIWZpcmVmb3hTaGltLnNoaW1QZWVyQ29ubmVjdGlvbiB8fFxuICAgICAgICAgICFvcHRpb25zLnNoaW1GaXJlZm94KSB7XG4gICAgICAgIGxvZ2dpbmcoJ0ZpcmVmb3ggc2hpbSBpcyBub3QgaW5jbHVkZWQgaW4gdGhpcyBhZGFwdGVyIHJlbGVhc2UuJyk7XG4gICAgICAgIHJldHVybiBhZGFwdGVyO1xuICAgICAgfVxuICAgICAgbG9nZ2luZygnYWRhcHRlci5qcyBzaGltbWluZyBmaXJlZm94LicpO1xuICAgICAgLy8gRXhwb3J0IHRvIHRoZSBhZGFwdGVyIGdsb2JhbCBvYmplY3QgdmlzaWJsZSBpbiB0aGUgYnJvd3Nlci5cbiAgICAgIGFkYXB0ZXIuYnJvd3NlclNoaW0gPSBmaXJlZm94U2hpbTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbUNyZWF0ZU9iamVjdFVSTCh3aW5kb3cpO1xuXG4gICAgICBmaXJlZm94U2hpbS5zaGltR2V0VXNlck1lZGlhKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltU291cmNlT2JqZWN0KHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltUGVlckNvbm5lY3Rpb24od2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1PblRyYWNrKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltUmVtb3ZlU3RyZWFtKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltU2VuZGVyR2V0U3RhdHMod2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1SZWNlaXZlckdldFN0YXRzKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltUlRDRGF0YUNoYW5uZWwod2luZG93KTtcblxuICAgICAgY29tbW9uU2hpbS5zaGltUlRDSWNlQ2FuZGlkYXRlKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1NYXhNZXNzYWdlU2l6ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltU2VuZFRocm93VHlwZUVycm9yKHdpbmRvdyk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdlZGdlJzpcbiAgICAgIGlmICghZWRnZVNoaW0gfHwgIWVkZ2VTaGltLnNoaW1QZWVyQ29ubmVjdGlvbiB8fCAhb3B0aW9ucy5zaGltRWRnZSkge1xuICAgICAgICBsb2dnaW5nKCdNUyBlZGdlIHNoaW0gaXMgbm90IGluY2x1ZGVkIGluIHRoaXMgYWRhcHRlciByZWxlYXNlLicpO1xuICAgICAgICByZXR1cm4gYWRhcHRlcjtcbiAgICAgIH1cbiAgICAgIGxvZ2dpbmcoJ2FkYXB0ZXIuanMgc2hpbW1pbmcgZWRnZS4nKTtcbiAgICAgIC8vIEV4cG9ydCB0byB0aGUgYWRhcHRlciBnbG9iYWwgb2JqZWN0IHZpc2libGUgaW4gdGhlIGJyb3dzZXIuXG4gICAgICBhZGFwdGVyLmJyb3dzZXJTaGltID0gZWRnZVNoaW07XG4gICAgICBjb21tb25TaGltLnNoaW1DcmVhdGVPYmplY3RVUkwod2luZG93KTtcblxuICAgICAgZWRnZVNoaW0uc2hpbUdldFVzZXJNZWRpYSh3aW5kb3cpO1xuICAgICAgZWRnZVNoaW0uc2hpbVBlZXJDb25uZWN0aW9uKHdpbmRvdyk7XG4gICAgICBlZGdlU2hpbS5zaGltUmVwbGFjZVRyYWNrKHdpbmRvdyk7XG5cbiAgICAgIC8vIHRoZSBlZGdlIHNoaW0gaW1wbGVtZW50cyB0aGUgZnVsbCBSVENJY2VDYW5kaWRhdGUgb2JqZWN0LlxuXG4gICAgICBjb21tb25TaGltLnNoaW1NYXhNZXNzYWdlU2l6ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltU2VuZFRocm93VHlwZUVycm9yKHdpbmRvdyk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdzYWZhcmknOlxuICAgICAgaWYgKCFzYWZhcmlTaGltIHx8ICFvcHRpb25zLnNoaW1TYWZhcmkpIHtcbiAgICAgICAgbG9nZ2luZygnU2FmYXJpIHNoaW0gaXMgbm90IGluY2x1ZGVkIGluIHRoaXMgYWRhcHRlciByZWxlYXNlLicpO1xuICAgICAgICByZXR1cm4gYWRhcHRlcjtcbiAgICAgIH1cbiAgICAgIGxvZ2dpbmcoJ2FkYXB0ZXIuanMgc2hpbW1pbmcgc2FmYXJpLicpO1xuICAgICAgLy8gRXhwb3J0IHRvIHRoZSBhZGFwdGVyIGdsb2JhbCBvYmplY3QgdmlzaWJsZSBpbiB0aGUgYnJvd3Nlci5cbiAgICAgIGFkYXB0ZXIuYnJvd3NlclNoaW0gPSBzYWZhcmlTaGltO1xuICAgICAgY29tbW9uU2hpbS5zaGltQ3JlYXRlT2JqZWN0VVJMKHdpbmRvdyk7XG5cbiAgICAgIHNhZmFyaVNoaW0uc2hpbVJUQ0ljZVNlcnZlclVybHMod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbUNhbGxiYWNrc0FQSSh3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltTG9jYWxTdHJlYW1zQVBJKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1SZW1vdGVTdHJlYW1zQVBJKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1UcmFja0V2ZW50VHJhbnNjZWl2ZXIod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbUdldFVzZXJNZWRpYSh3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltQ3JlYXRlT2ZmZXJMZWdhY3kod2luZG93KTtcblxuICAgICAgY29tbW9uU2hpbS5zaGltUlRDSWNlQ2FuZGlkYXRlKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1NYXhNZXNzYWdlU2l6ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltU2VuZFRocm93VHlwZUVycm9yKHdpbmRvdyk7XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgbG9nZ2luZygnVW5zdXBwb3J0ZWQgYnJvd3NlciEnKTtcbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgcmV0dXJuIGFkYXB0ZXI7XG59O1xuIiwiXG4vKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzLmpzJyk7XG52YXIgbG9nZ2luZyA9IHV0aWxzLmxvZztcblxuLyogaXRlcmF0ZXMgdGhlIHN0YXRzIGdyYXBoIHJlY3Vyc2l2ZWx5LiAqL1xuZnVuY3Rpb24gd2Fsa1N0YXRzKHN0YXRzLCBiYXNlLCByZXN1bHRTZXQpIHtcbiAgaWYgKCFiYXNlIHx8IHJlc3VsdFNldC5oYXMoYmFzZS5pZCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgcmVzdWx0U2V0LnNldChiYXNlLmlkLCBiYXNlKTtcbiAgT2JqZWN0LmtleXMoYmFzZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgaWYgKG5hbWUuZW5kc1dpdGgoJ0lkJykpIHtcbiAgICAgIHdhbGtTdGF0cyhzdGF0cywgc3RhdHMuZ2V0KGJhc2VbbmFtZV0pLCByZXN1bHRTZXQpO1xuICAgIH0gZWxzZSBpZiAobmFtZS5lbmRzV2l0aCgnSWRzJykpIHtcbiAgICAgIGJhc2VbbmFtZV0uZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgICAgICB3YWxrU3RhdHMoc3RhdHMsIHN0YXRzLmdldChpZCksIHJlc3VsdFNldCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xufVxuXG4vKiBmaWx0ZXIgZ2V0U3RhdHMgZm9yIGEgc2VuZGVyL3JlY2VpdmVyIHRyYWNrLiAqL1xuZnVuY3Rpb24gZmlsdGVyU3RhdHMocmVzdWx0LCB0cmFjaywgb3V0Ym91bmQpIHtcbiAgdmFyIHN0cmVhbVN0YXRzVHlwZSA9IG91dGJvdW5kID8gJ291dGJvdW5kLXJ0cCcgOiAnaW5ib3VuZC1ydHAnO1xuICB2YXIgZmlsdGVyZWRSZXN1bHQgPSBuZXcgTWFwKCk7XG4gIGlmICh0cmFjayA9PT0gbnVsbCkge1xuICAgIHJldHVybiBmaWx0ZXJlZFJlc3VsdDtcbiAgfVxuICB2YXIgdHJhY2tTdGF0cyA9IFtdO1xuICByZXN1bHQuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZS50eXBlID09PSAndHJhY2snICYmXG4gICAgICAgIHZhbHVlLnRyYWNrSWRlbnRpZmllciA9PT0gdHJhY2suaWQpIHtcbiAgICAgIHRyYWNrU3RhdHMucHVzaCh2YWx1ZSk7XG4gICAgfVxuICB9KTtcbiAgdHJhY2tTdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrU3RhdCkge1xuICAgIHJlc3VsdC5mb3JFYWNoKGZ1bmN0aW9uKHN0YXRzKSB7XG4gICAgICBpZiAoc3RhdHMudHlwZSA9PT0gc3RyZWFtU3RhdHNUeXBlICYmIHN0YXRzLnRyYWNrSWQgPT09IHRyYWNrU3RhdC5pZCkge1xuICAgICAgICB3YWxrU3RhdHMocmVzdWx0LCBzdGF0cywgZmlsdGVyZWRSZXN1bHQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIGZpbHRlcmVkUmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc2hpbUdldFVzZXJNZWRpYTogcmVxdWlyZSgnLi9nZXR1c2VybWVkaWEnKSxcbiAgc2hpbU1lZGlhU3RyZWFtOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB3aW5kb3cuTWVkaWFTdHJlYW0gPSB3aW5kb3cuTWVkaWFTdHJlYW0gfHwgd2luZG93LndlYmtpdE1lZGlhU3RyZWFtO1xuICB9LFxuXG4gIHNoaW1PblRyYWNrOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmICEoJ29udHJhY2snIGluXG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ29udHJhY2snLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX29udHJhY2s7XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24oZikge1xuICAgICAgICAgIGlmICh0aGlzLl9vbnRyYWNrKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb250cmFjayk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbnRyYWNrID0gZik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdmFyIG9yaWdTZXRSZW1vdGVEZXNjcmlwdGlvbiA9XG4gICAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbjtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgaWYgKCFwYy5fb250cmFja3BvbHkpIHtcbiAgICAgICAgICBwYy5fb250cmFja3BvbHkgPSBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICAvLyBvbmFkZHN0cmVhbSBkb2VzIG5vdCBmaXJlIHdoZW4gYSB0cmFjayBpcyBhZGRlZCB0byBhbiBleGlzdGluZ1xuICAgICAgICAgICAgLy8gc3RyZWFtLiBCdXQgc3RyZWFtLm9uYWRkdHJhY2sgaXMgaW1wbGVtZW50ZWQgc28gd2UgdXNlIHRoYXQuXG4gICAgICAgICAgICBlLnN0cmVhbS5hZGRFdmVudExpc3RlbmVyKCdhZGR0cmFjaycsIGZ1bmN0aW9uKHRlKSB7XG4gICAgICAgICAgICAgIHZhciByZWNlaXZlcjtcbiAgICAgICAgICAgICAgaWYgKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzKSB7XG4gICAgICAgICAgICAgICAgcmVjZWl2ZXIgPSBwYy5nZXRSZWNlaXZlcnMoKS5maW5kKGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiByLnRyYWNrICYmIHIudHJhY2suaWQgPT09IHRlLnRyYWNrLmlkO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlY2VpdmVyID0ge3RyYWNrOiB0ZS50cmFja307XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ3RyYWNrJyk7XG4gICAgICAgICAgICAgIGV2ZW50LnRyYWNrID0gdGUudHJhY2s7XG4gICAgICAgICAgICAgIGV2ZW50LnJlY2VpdmVyID0gcmVjZWl2ZXI7XG4gICAgICAgICAgICAgIGV2ZW50LnRyYW5zY2VpdmVyID0ge3JlY2VpdmVyOiByZWNlaXZlcn07XG4gICAgICAgICAgICAgIGV2ZW50LnN0cmVhbXMgPSBbZS5zdHJlYW1dO1xuICAgICAgICAgICAgICBwYy5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgZS5zdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB2YXIgcmVjZWl2ZXI7XG4gICAgICAgICAgICAgIGlmICh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycykge1xuICAgICAgICAgICAgICAgIHJlY2VpdmVyID0gcGMuZ2V0UmVjZWl2ZXJzKCkuZmluZChmdW5jdGlvbihyKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gci50cmFjayAmJiByLnRyYWNrLmlkID09PSB0cmFjay5pZDtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlciA9IHt0cmFjazogdHJhY2t9O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgndHJhY2snKTtcbiAgICAgICAgICAgICAgZXZlbnQudHJhY2sgPSB0cmFjaztcbiAgICAgICAgICAgICAgZXZlbnQucmVjZWl2ZXIgPSByZWNlaXZlcjtcbiAgICAgICAgICAgICAgZXZlbnQudHJhbnNjZWl2ZXIgPSB7cmVjZWl2ZXI6IHJlY2VpdmVyfTtcbiAgICAgICAgICAgICAgZXZlbnQuc3RyZWFtcyA9IFtlLnN0cmVhbV07XG4gICAgICAgICAgICAgIHBjLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfTtcbiAgICAgICAgICBwYy5hZGRFdmVudExpc3RlbmVyKCdhZGRzdHJlYW0nLCBwYy5fb250cmFja3BvbHkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvcmlnU2V0UmVtb3RlRGVzY3JpcHRpb24uYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoISgnUlRDUnRwVHJhbnNjZWl2ZXInIGluIHdpbmRvdykpIHtcbiAgICAgIHV0aWxzLndyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgJ3RyYWNrJywgZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoIWUudHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBlLnRyYW5zY2VpdmVyID0ge3JlY2VpdmVyOiBlLnJlY2VpdmVyfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICBzaGltR2V0U2VuZGVyc1dpdGhEdG1mOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBPdmVycmlkZXMgYWRkVHJhY2svcmVtb3ZlVHJhY2ssIGRlcGVuZHMgb24gc2hpbUFkZFRyYWNrUmVtb3ZlVHJhY2suXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICAhKCdnZXRTZW5kZXJzJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSAmJlxuICAgICAgICAnY3JlYXRlRFRNRlNlbmRlcicgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkge1xuICAgICAgdmFyIHNoaW1TZW5kZXJXaXRoRHRtZiA9IGZ1bmN0aW9uKHBjLCB0cmFjaykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHRyYWNrOiB0cmFjayxcbiAgICAgICAgICBnZXQgZHRtZigpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl9kdG1mID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgaWYgKHRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gcGMuY3JlYXRlRFRNRlNlbmRlcih0cmFjayk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IG51bGw7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9kdG1mO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgX3BjOiBwY1xuICAgICAgICB9O1xuICAgICAgfTtcblxuICAgICAgLy8gYXVnbWVudCBhZGRUcmFjayB3aGVuIGdldFNlbmRlcnMgaXMgbm90IGF2YWlsYWJsZS5cbiAgICAgIGlmICghd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzKSB7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuX3NlbmRlcnMgPSB0aGlzLl9zZW5kZXJzIHx8IFtdO1xuICAgICAgICAgIHJldHVybiB0aGlzLl9zZW5kZXJzLnNsaWNlKCk7IC8vIHJldHVybiBhIGNvcHkgb2YgdGhlIGludGVybmFsIHN0YXRlLlxuICAgICAgICB9O1xuICAgICAgICB2YXIgb3JpZ0FkZFRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjaztcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKHRyYWNrLCBzdHJlYW0pIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIHZhciBzZW5kZXIgPSBvcmlnQWRkVHJhY2suYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgaWYgKCFzZW5kZXIpIHtcbiAgICAgICAgICAgIHNlbmRlciA9IHNoaW1TZW5kZXJXaXRoRHRtZihwYywgdHJhY2spO1xuICAgICAgICAgICAgcGMuX3NlbmRlcnMucHVzaChzZW5kZXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gc2VuZGVyO1xuICAgICAgICB9O1xuXG4gICAgICAgIHZhciBvcmlnUmVtb3ZlVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrO1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrID0gZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICBvcmlnUmVtb3ZlVHJhY2suYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgdmFyIGlkeCA9IHBjLl9zZW5kZXJzLmluZGV4T2Yoc2VuZGVyKTtcbiAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkge1xuICAgICAgICAgICAgcGMuX3NlbmRlcnMuc3BsaWNlKGlkeCwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgdmFyIG9yaWdBZGRTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHBjLl9zZW5kZXJzID0gcGMuX3NlbmRlcnMgfHwgW107XG4gICAgICAgIG9yaWdBZGRTdHJlYW0uYXBwbHkocGMsIFtzdHJlYW1dKTtcbiAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICBwYy5fc2VuZGVycy5wdXNoKHNoaW1TZW5kZXJXaXRoRHRtZihwYywgdHJhY2spKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICB2YXIgb3JpZ1JlbW92ZVN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgcGMuX3NlbmRlcnMgPSBwYy5fc2VuZGVycyB8fCBbXTtcbiAgICAgICAgb3JpZ1JlbW92ZVN0cmVhbS5hcHBseShwYywgW3N0cmVhbV0pO1xuXG4gICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgdmFyIHNlbmRlciA9IHBjLl9zZW5kZXJzLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChzZW5kZXIpIHtcbiAgICAgICAgICAgIHBjLl9zZW5kZXJzLnNwbGljZShwYy5fc2VuZGVycy5pbmRleE9mKHNlbmRlciksIDEpOyAvLyByZW1vdmUgc2VuZGVyXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgICAgICAgICdnZXRTZW5kZXJzJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlICYmXG4gICAgICAgICAgICAgICAnY3JlYXRlRFRNRlNlbmRlcicgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSAmJlxuICAgICAgICAgICAgICAgd2luZG93LlJUQ1J0cFNlbmRlciAmJlxuICAgICAgICAgICAgICAgISgnZHRtZicgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUpKSB7XG4gICAgICB2YXIgb3JpZ0dldFNlbmRlcnMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnM7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgdmFyIHNlbmRlcnMgPSBvcmlnR2V0U2VuZGVycy5hcHBseShwYywgW10pO1xuICAgICAgICBzZW5kZXJzLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgICAgc2VuZGVyLl9wYyA9IHBjO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHNlbmRlcnM7XG4gICAgICB9O1xuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUsICdkdG1mJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICh0aGlzLl9kdG1mID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IHRoaXMuX3BjLmNyZWF0ZURUTUZTZW5kZXIodGhpcy50cmFjayk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2R0bWY7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICBzaGltU2VuZGVyUmVjZWl2ZXJHZXRTdGF0czogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKCEodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIgJiYgd2luZG93LlJUQ1J0cFJlY2VpdmVyKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIHNoaW0gc2VuZGVyIHN0YXRzLlxuICAgIGlmICghKCdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUpKSB7XG4gICAgICB2YXIgb3JpZ0dldFNlbmRlcnMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnM7XG4gICAgICBpZiAob3JpZ0dldFNlbmRlcnMpIHtcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICB2YXIgc2VuZGVycyA9IG9yaWdHZXRTZW5kZXJzLmFwcGx5KHBjLCBbXSk7XG4gICAgICAgICAgc2VuZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICAgICAgc2VuZGVyLl9wYyA9IHBjO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBzZW5kZXJzO1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICB2YXIgb3JpZ0FkZFRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjaztcbiAgICAgIGlmIChvcmlnQWRkVHJhY2spIHtcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBzZW5kZXIgPSBvcmlnQWRkVHJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICBzZW5kZXIuX3BjID0gdGhpcztcbiAgICAgICAgICByZXR1cm4gc2VuZGVyO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHNlbmRlciA9IHRoaXM7XG4gICAgICAgIHJldHVybiB0aGlzLl9wYy5nZXRTdGF0cygpLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgICAgICAgLyogTm90ZTogdGhpcyB3aWxsIGluY2x1ZGUgc3RhdHMgb2YgYWxsIHNlbmRlcnMgdGhhdFxuICAgICAgICAgICAqICAgc2VuZCBhIHRyYWNrIHdpdGggdGhlIHNhbWUgaWQgYXMgc2VuZGVyLnRyYWNrIGFzXG4gICAgICAgICAgICogICBpdCBpcyBub3QgcG9zc2libGUgdG8gaWRlbnRpZnkgdGhlIFJUQ1J0cFNlbmRlci5cbiAgICAgICAgICAgKi9cbiAgICAgICAgICByZXR1cm4gZmlsdGVyU3RhdHMocmVzdWx0LCBzZW5kZXIudHJhY2ssIHRydWUpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gc2hpbSByZWNlaXZlciBzdGF0cy5cbiAgICBpZiAoISgnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBSZWNlaXZlci5wcm90b3R5cGUpKSB7XG4gICAgICB2YXIgb3JpZ0dldFJlY2VpdmVycyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzO1xuICAgICAgaWYgKG9yaWdHZXRSZWNlaXZlcnMpIHtcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIHZhciByZWNlaXZlcnMgPSBvcmlnR2V0UmVjZWl2ZXJzLmFwcGx5KHBjLCBbXSk7XG4gICAgICAgICAgcmVjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24ocmVjZWl2ZXIpIHtcbiAgICAgICAgICAgIHJlY2VpdmVyLl9wYyA9IHBjO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiByZWNlaXZlcnM7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICB1dGlscy53cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csICd0cmFjaycsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgZS5yZWNlaXZlci5fcGMgPSBlLnNyY0VsZW1lbnQ7XG4gICAgICAgIHJldHVybiBlO1xuICAgICAgfSk7XG4gICAgICB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByZWNlaXZlciA9IHRoaXM7XG4gICAgICAgIHJldHVybiB0aGlzLl9wYy5nZXRTdGF0cygpLnRoZW4oZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgICAgICAgcmV0dXJuIGZpbHRlclN0YXRzKHJlc3VsdCwgcmVjZWl2ZXIudHJhY2ssIGZhbHNlKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmICghKCdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUgJiZcbiAgICAgICAgJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIucHJvdG90eXBlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIHNoaW0gUlRDUGVlckNvbm5lY3Rpb24uZ2V0U3RhdHModHJhY2spLlxuICAgIHZhciBvcmlnR2V0U3RhdHMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDAgJiZcbiAgICAgICAgICBhcmd1bWVudHNbMF0gaW5zdGFuY2VvZiB3aW5kb3cuTWVkaWFTdHJlYW1UcmFjaykge1xuICAgICAgICB2YXIgdHJhY2sgPSBhcmd1bWVudHNbMF07XG4gICAgICAgIHZhciBzZW5kZXI7XG4gICAgICAgIHZhciByZWNlaXZlcjtcbiAgICAgICAgdmFyIGVycjtcbiAgICAgICAgcGMuZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24ocykge1xuICAgICAgICAgIGlmIChzLnRyYWNrID09PSB0cmFjaykge1xuICAgICAgICAgICAgaWYgKHNlbmRlcikge1xuICAgICAgICAgICAgICBlcnIgPSB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgc2VuZGVyID0gcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBwYy5nZXRSZWNlaXZlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICBpZiAoci50cmFjayA9PT0gdHJhY2spIHtcbiAgICAgICAgICAgIGlmIChyZWNlaXZlcikge1xuICAgICAgICAgICAgICBlcnIgPSB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmVjZWl2ZXIgPSByO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gci50cmFjayA9PT0gdHJhY2s7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZXJyIHx8IChzZW5kZXIgJiYgcmVjZWl2ZXIpKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBET01FeGNlcHRpb24oXG4gICAgICAgICAgICAnVGhlcmUgYXJlIG1vcmUgdGhhbiBvbmUgc2VuZGVyIG9yIHJlY2VpdmVyIGZvciB0aGUgdHJhY2suJyxcbiAgICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoc2VuZGVyKSB7XG4gICAgICAgICAgcmV0dXJuIHNlbmRlci5nZXRTdGF0cygpO1xuICAgICAgICB9IGVsc2UgaWYgKHJlY2VpdmVyKSB7XG4gICAgICAgICAgcmV0dXJuIHJlY2VpdmVyLmdldFN0YXRzKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBET01FeGNlcHRpb24oXG4gICAgICAgICAgJ1RoZXJlIGlzIG5vIHNlbmRlciBvciByZWNlaXZlciBmb3IgdGhlIHRyYWNrLicsXG4gICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvcmlnR2V0U3RhdHMuYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltU291cmNlT2JqZWN0OiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgVVJMID0gd2luZG93ICYmIHdpbmRvdy5VUkw7XG5cbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh3aW5kb3cuSFRNTE1lZGlhRWxlbWVudCAmJlxuICAgICAgICAhKCdzcmNPYmplY3QnIGluIHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSkpIHtcbiAgICAgICAgLy8gU2hpbSB0aGUgc3JjT2JqZWN0IHByb3BlcnR5LCBvbmNlLCB3aGVuIEhUTUxNZWRpYUVsZW1lbnQgaXMgZm91bmQuXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUsICdzcmNPYmplY3QnLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9zcmNPYmplY3Q7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICAgICAgLy8gVXNlIF9zcmNPYmplY3QgYXMgYSBwcml2YXRlIHByb3BlcnR5IGZvciB0aGlzIHNoaW1cbiAgICAgICAgICAgIHRoaXMuX3NyY09iamVjdCA9IHN0cmVhbTtcbiAgICAgICAgICAgIGlmICh0aGlzLnNyYykge1xuICAgICAgICAgICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHRoaXMuc3JjKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgICAgICAgICAgdGhpcy5zcmMgPSAnJztcbiAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc3JjID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzdHJlYW0pO1xuICAgICAgICAgICAgLy8gV2UgbmVlZCB0byByZWNyZWF0ZSB0aGUgYmxvYiB1cmwgd2hlbiBhIHRyYWNrIGlzIGFkZGVkIG9yXG4gICAgICAgICAgICAvLyByZW1vdmVkLiBEb2luZyBpdCBtYW51YWxseSBzaW5jZSB3ZSB3YW50IHRvIGF2b2lkIGEgcmVjdXJzaW9uLlxuICAgICAgICAgICAgc3RyZWFtLmFkZEV2ZW50TGlzdGVuZXIoJ2FkZHRyYWNrJywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgIGlmIChzZWxmLnNyYykge1xuICAgICAgICAgICAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwoc2VsZi5zcmMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHNlbGYuc3JjID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzdHJlYW0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBzdHJlYW0uYWRkRXZlbnRMaXN0ZW5lcigncmVtb3ZldHJhY2snLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgaWYgKHNlbGYuc3JjKSB7XG4gICAgICAgICAgICAgICAgVVJMLnJldm9rZU9iamVjdFVSTChzZWxmLnNyYyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc2VsZi5zcmMgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKHN0cmVhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBzaGltQWRkVHJhY2tSZW1vdmVUcmFja1dpdGhOYXRpdmU6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIHNoaW0gYWRkVHJhY2svcmVtb3ZlVHJhY2sgd2l0aCBuYXRpdmUgdmFyaWFudHMgaW4gb3JkZXIgdG8gbWFrZVxuICAgIC8vIHRoZSBpbnRlcmFjdGlvbnMgd2l0aCBsZWdhY3kgZ2V0TG9jYWxTdHJlYW1zIGJlaGF2ZSBhcyBpbiBvdGhlciBicm93c2Vycy5cbiAgICAvLyBLZWVwcyBhIG1hcHBpbmcgc3RyZWFtLmlkID0+IFtzdHJlYW0sIHJ0cHNlbmRlcnMuLi5dXG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRMb2NhbFN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zID0gdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyB8fCB7fTtcbiAgICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zKS5tYXAoZnVuY3Rpb24oc3RyZWFtSWQpIHtcbiAgICAgICAgcmV0dXJuIHBjLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbUlkXVswXTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ0FkZFRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjaztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24odHJhY2ssIHN0cmVhbSkge1xuICAgICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgICAgcmV0dXJuIG9yaWdBZGRUcmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfVxuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyA9IHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgfHwge307XG5cbiAgICAgIHZhciBzZW5kZXIgPSBvcmlnQWRkVHJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIGlmICghdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdKSB7XG4gICAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXSA9IFtzdHJlYW0sIHNlbmRlcl07XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXS5pbmRleE9mKHNlbmRlcikgPT09IC0xKSB7XG4gICAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXS5wdXNoKHNlbmRlcik7XG4gICAgICB9XG4gICAgICByZXR1cm4gc2VuZGVyO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ0FkZFN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyA9IHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgfHwge307XG5cbiAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgIHZhciBhbHJlYWR5RXhpc3RzID0gcGMuZ2V0U2VuZGVycygpLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChhbHJlYWR5RXhpc3RzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignVHJhY2sgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHZhciBleGlzdGluZ1NlbmRlcnMgPSBwYy5nZXRTZW5kZXJzKCk7XG4gICAgICBvcmlnQWRkU3RyZWFtLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB2YXIgbmV3U2VuZGVycyA9IHBjLmdldFNlbmRlcnMoKS5maWx0ZXIoZnVuY3Rpb24obmV3U2VuZGVyKSB7XG4gICAgICAgIHJldHVybiBleGlzdGluZ1NlbmRlcnMuaW5kZXhPZihuZXdTZW5kZXIpID09PSAtMTtcbiAgICAgIH0pO1xuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdID0gW3N0cmVhbV0uY29uY2F0KG5ld1NlbmRlcnMpO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ1JlbW92ZVN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zID0gdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyB8fCB7fTtcbiAgICAgIGRlbGV0ZSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF07XG4gICAgICByZXR1cm4gb3JpZ1JlbW92ZVN0cmVhbS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ1JlbW92ZVRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjaztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrID0gZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyA9IHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgfHwge307XG4gICAgICBpZiAoc2VuZGVyKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMpLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtSWQpIHtcbiAgICAgICAgICB2YXIgaWR4ID0gcGMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtSWRdLmluZGV4T2Yoc2VuZGVyKTtcbiAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkge1xuICAgICAgICAgICAgcGMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtSWRdLnNwbGljZShpZHgsIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAocGMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtSWRdLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgZGVsZXRlIHBjLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbUlkXTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG9yaWdSZW1vdmVUcmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbUFkZFRyYWNrUmVtb3ZlVHJhY2s6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcbiAgICAvLyBzaGltIGFkZFRyYWNrIGFuZCByZW1vdmVUcmFjay5cbiAgICBpZiAod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayAmJlxuICAgICAgICBicm93c2VyRGV0YWlscy52ZXJzaW9uID49IDY1KSB7XG4gICAgICByZXR1cm4gdGhpcy5zaGltQWRkVHJhY2tSZW1vdmVUcmFja1dpdGhOYXRpdmUod2luZG93KTtcbiAgICB9XG5cbiAgICAvLyBhbHNvIHNoaW0gcGMuZ2V0TG9jYWxTdHJlYW1zIHdoZW4gYWRkVHJhY2sgaXMgc2hpbW1lZFxuICAgIC8vIHRvIHJldHVybiB0aGUgb3JpZ2luYWwgc3RyZWFtcy5cbiAgICB2YXIgb3JpZ0dldExvY2FsU3RyZWFtcyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVcbiAgICAgICAgLmdldExvY2FsU3RyZWFtcztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldExvY2FsU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHZhciBuYXRpdmVTdHJlYW1zID0gb3JpZ0dldExvY2FsU3RyZWFtcy5hcHBseSh0aGlzKTtcbiAgICAgIHBjLl9yZXZlcnNlU3RyZWFtcyA9IHBjLl9yZXZlcnNlU3RyZWFtcyB8fCB7fTtcbiAgICAgIHJldHVybiBuYXRpdmVTdHJlYW1zLm1hcChmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgcmV0dXJuIHBjLl9yZXZlcnNlU3RyZWFtc1tzdHJlYW0uaWRdO1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIHZhciBvcmlnQWRkU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBwYy5fc3RyZWFtcyA9IHBjLl9zdHJlYW1zIHx8IHt9O1xuICAgICAgcGMuX3JldmVyc2VTdHJlYW1zID0gcGMuX3JldmVyc2VTdHJlYW1zIHx8IHt9O1xuXG4gICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICB2YXIgYWxyZWFkeUV4aXN0cyA9IHBjLmdldFNlbmRlcnMoKS5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoYWxyZWFkeUV4aXN0cykge1xuICAgICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ1RyYWNrIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBBZGQgaWRlbnRpdHkgbWFwcGluZyBmb3IgY29uc2lzdGVuY3kgd2l0aCBhZGRUcmFjay5cbiAgICAgIC8vIFVubGVzcyB0aGlzIGlzIGJlaW5nIHVzZWQgd2l0aCBhIHN0cmVhbSBmcm9tIGFkZFRyYWNrLlxuICAgICAgaWYgKCFwYy5fcmV2ZXJzZVN0cmVhbXNbc3RyZWFtLmlkXSkge1xuICAgICAgICB2YXIgbmV3U3RyZWFtID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbShzdHJlYW0uZ2V0VHJhY2tzKCkpO1xuICAgICAgICBwYy5fc3RyZWFtc1tzdHJlYW0uaWRdID0gbmV3U3RyZWFtO1xuICAgICAgICBwYy5fcmV2ZXJzZVN0cmVhbXNbbmV3U3RyZWFtLmlkXSA9IHN0cmVhbTtcbiAgICAgICAgc3RyZWFtID0gbmV3U3RyZWFtO1xuICAgICAgfVxuICAgICAgb3JpZ0FkZFN0cmVhbS5hcHBseShwYywgW3N0cmVhbV0pO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ1JlbW92ZVN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgcGMuX3N0cmVhbXMgPSBwYy5fc3RyZWFtcyB8fCB7fTtcbiAgICAgIHBjLl9yZXZlcnNlU3RyZWFtcyA9IHBjLl9yZXZlcnNlU3RyZWFtcyB8fCB7fTtcblxuICAgICAgb3JpZ1JlbW92ZVN0cmVhbS5hcHBseShwYywgWyhwYy5fc3RyZWFtc1tzdHJlYW0uaWRdIHx8IHN0cmVhbSldKTtcbiAgICAgIGRlbGV0ZSBwYy5fcmV2ZXJzZVN0cmVhbXNbKHBjLl9zdHJlYW1zW3N0cmVhbS5pZF0gP1xuICAgICAgICAgIHBjLl9zdHJlYW1zW3N0cmVhbS5pZF0uaWQgOiBzdHJlYW0uaWQpXTtcbiAgICAgIGRlbGV0ZSBwYy5fc3RyZWFtc1tzdHJlYW0uaWRdO1xuICAgIH07XG5cbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24odHJhY2ssIHN0cmVhbSkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIGlmIChwYy5zaWduYWxpbmdTdGF0ZSA9PT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbihcbiAgICAgICAgICAnVGhlIFJUQ1BlZXJDb25uZWN0aW9uXFwncyBzaWduYWxpbmdTdGF0ZSBpcyBcXCdjbG9zZWRcXCcuJyxcbiAgICAgICAgICAnSW52YWxpZFN0YXRlRXJyb3InKTtcbiAgICAgIH1cbiAgICAgIHZhciBzdHJlYW1zID0gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgaWYgKHN0cmVhbXMubGVuZ3RoICE9PSAxIHx8XG4gICAgICAgICAgIXN0cmVhbXNbMF0uZ2V0VHJhY2tzKCkuZmluZChmdW5jdGlvbih0KSB7XG4gICAgICAgICAgICByZXR1cm4gdCA9PT0gdHJhY2s7XG4gICAgICAgICAgfSkpIHtcbiAgICAgICAgLy8gdGhpcyBpcyBub3QgZnVsbHkgY29ycmVjdCBidXQgYWxsIHdlIGNhbiBtYW5hZ2Ugd2l0aG91dFxuICAgICAgICAvLyBbW2Fzc29jaWF0ZWQgTWVkaWFTdHJlYW1zXV0gaW50ZXJuYWwgc2xvdC5cbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbihcbiAgICAgICAgICAnVGhlIGFkYXB0ZXIuanMgYWRkVHJhY2sgcG9seWZpbGwgb25seSBzdXBwb3J0cyBhIHNpbmdsZSAnICtcbiAgICAgICAgICAnIHN0cmVhbSB3aGljaCBpcyBhc3NvY2lhdGVkIHdpdGggdGhlIHNwZWNpZmllZCB0cmFjay4nLFxuICAgICAgICAgICdOb3RTdXBwb3J0ZWRFcnJvcicpO1xuICAgICAgfVxuXG4gICAgICB2YXIgYWxyZWFkeUV4aXN0cyA9IHBjLmdldFNlbmRlcnMoKS5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgfSk7XG4gICAgICBpZiAoYWxyZWFkeUV4aXN0cykge1xuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdUcmFjayBhbHJlYWR5IGV4aXN0cy4nLFxuICAgICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpO1xuICAgICAgfVxuXG4gICAgICBwYy5fc3RyZWFtcyA9IHBjLl9zdHJlYW1zIHx8IHt9O1xuICAgICAgcGMuX3JldmVyc2VTdHJlYW1zID0gcGMuX3JldmVyc2VTdHJlYW1zIHx8IHt9O1xuICAgICAgdmFyIG9sZFN0cmVhbSA9IHBjLl9zdHJlYW1zW3N0cmVhbS5pZF07XG4gICAgICBpZiAob2xkU3RyZWFtKSB7XG4gICAgICAgIC8vIHRoaXMgaXMgdXNpbmcgb2RkIENocm9tZSBiZWhhdmlvdXIsIHVzZSB3aXRoIGNhdXRpb246XG4gICAgICAgIC8vIGh0dHBzOi8vYnVncy5jaHJvbWl1bS5vcmcvcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD03ODE1XG4gICAgICAgIC8vIE5vdGU6IHdlIHJlbHkgb24gdGhlIGhpZ2gtbGV2ZWwgYWRkVHJhY2svZHRtZiBzaGltIHRvXG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgc2VuZGVyIHdpdGggYSBkdG1mIHNlbmRlci5cbiAgICAgICAgb2xkU3RyZWFtLmFkZFRyYWNrKHRyYWNrKTtcblxuICAgICAgICAvLyBUcmlnZ2VyIE9OTiBhc3luYy5cbiAgICAgICAgUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgICBwYy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVnb3RpYXRpb25uZWVkZWQnKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG5ld1N0cmVhbSA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oW3RyYWNrXSk7XG4gICAgICAgIHBjLl9zdHJlYW1zW3N0cmVhbS5pZF0gPSBuZXdTdHJlYW07XG4gICAgICAgIHBjLl9yZXZlcnNlU3RyZWFtc1tuZXdTdHJlYW0uaWRdID0gc3RyZWFtO1xuICAgICAgICBwYy5hZGRTdHJlYW0obmV3U3RyZWFtKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBwYy5nZXRTZW5kZXJzKCkuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvLyByZXBsYWNlIHRoZSBpbnRlcm5hbCBzdHJlYW0gaWQgd2l0aCB0aGUgZXh0ZXJuYWwgb25lIGFuZFxuICAgIC8vIHZpY2UgdmVyc2EuXG4gICAgZnVuY3Rpb24gcmVwbGFjZUludGVybmFsU3RyZWFtSWQocGMsIGRlc2NyaXB0aW9uKSB7XG4gICAgICB2YXIgc2RwID0gZGVzY3JpcHRpb24uc2RwO1xuICAgICAgT2JqZWN0LmtleXMocGMuX3JldmVyc2VTdHJlYW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uKGludGVybmFsSWQpIHtcbiAgICAgICAgdmFyIGV4dGVybmFsU3RyZWFtID0gcGMuX3JldmVyc2VTdHJlYW1zW2ludGVybmFsSWRdO1xuICAgICAgICB2YXIgaW50ZXJuYWxTdHJlYW0gPSBwYy5fc3RyZWFtc1tleHRlcm5hbFN0cmVhbS5pZF07XG4gICAgICAgIHNkcCA9IHNkcC5yZXBsYWNlKG5ldyBSZWdFeHAoaW50ZXJuYWxTdHJlYW0uaWQsICdnJyksXG4gICAgICAgICAgICBleHRlcm5hbFN0cmVhbS5pZCk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBuZXcgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKHtcbiAgICAgICAgdHlwZTogZGVzY3JpcHRpb24udHlwZSxcbiAgICAgICAgc2RwOiBzZHBcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmdW5jdGlvbiByZXBsYWNlRXh0ZXJuYWxTdHJlYW1JZChwYywgZGVzY3JpcHRpb24pIHtcbiAgICAgIHZhciBzZHAgPSBkZXNjcmlwdGlvbi5zZHA7XG4gICAgICBPYmplY3Qua2V5cyhwYy5fcmV2ZXJzZVN0cmVhbXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24oaW50ZXJuYWxJZCkge1xuICAgICAgICB2YXIgZXh0ZXJuYWxTdHJlYW0gPSBwYy5fcmV2ZXJzZVN0cmVhbXNbaW50ZXJuYWxJZF07XG4gICAgICAgIHZhciBpbnRlcm5hbFN0cmVhbSA9IHBjLl9zdHJlYW1zW2V4dGVybmFsU3RyZWFtLmlkXTtcbiAgICAgICAgc2RwID0gc2RwLnJlcGxhY2UobmV3IFJlZ0V4cChleHRlcm5hbFN0cmVhbS5pZCwgJ2cnKSxcbiAgICAgICAgICAgIGludGVybmFsU3RyZWFtLmlkKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIG5ldyBSVENTZXNzaW9uRGVzY3JpcHRpb24oe1xuICAgICAgICB0eXBlOiBkZXNjcmlwdGlvbi50eXBlLFxuICAgICAgICBzZHA6IHNkcFxuICAgICAgfSk7XG4gICAgfVxuICAgIFsnY3JlYXRlT2ZmZXInLCAnY3JlYXRlQW5zd2VyJ10uZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgIHZhciBuYXRpdmVNZXRob2QgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICAgIHZhciBpc0xlZ2FjeUNhbGwgPSBhcmd1bWVudHMubGVuZ3RoICYmXG4gICAgICAgICAgICB0eXBlb2YgYXJndW1lbnRzWzBdID09PSAnZnVuY3Rpb24nO1xuICAgICAgICBpZiAoaXNMZWdhY3lDYWxsKSB7XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseShwYywgW1xuICAgICAgICAgICAgZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICAgICAgICAgICAgdmFyIGRlc2MgPSByZXBsYWNlSW50ZXJuYWxTdHJlYW1JZChwYywgZGVzY3JpcHRpb24pO1xuICAgICAgICAgICAgICBhcmdzWzBdLmFwcGx5KG51bGwsIFtkZXNjXSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZnVuY3Rpb24oZXJyKSB7XG4gICAgICAgICAgICAgIGlmIChhcmdzWzFdKSB7XG4gICAgICAgICAgICAgICAgYXJnc1sxXS5hcHBseShudWxsLCBlcnIpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBhcmd1bWVudHNbMl1cbiAgICAgICAgICBdKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHBjLCBhcmd1bWVudHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgICAgICAgcmV0dXJuIHJlcGxhY2VJbnRlcm5hbFN0cmVhbUlkKHBjLCBkZXNjcmlwdGlvbik7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9KTtcblxuICAgIHZhciBvcmlnU2V0TG9jYWxEZXNjcmlwdGlvbiA9XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0TG9jYWxEZXNjcmlwdGlvbjtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldExvY2FsRGVzY3JpcHRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGggfHwgIWFyZ3VtZW50c1swXS50eXBlKSB7XG4gICAgICAgIHJldHVybiBvcmlnU2V0TG9jYWxEZXNjcmlwdGlvbi5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICAgIGFyZ3VtZW50c1swXSA9IHJlcGxhY2VFeHRlcm5hbFN0cmVhbUlkKHBjLCBhcmd1bWVudHNbMF0pO1xuICAgICAgcmV0dXJuIG9yaWdTZXRMb2NhbERlc2NyaXB0aW9uLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgIH07XG5cbiAgICAvLyBUT0RPOiBtYW5nbGUgZ2V0U3RhdHM6IGh0dHBzOi8vdzNjLmdpdGh1Yi5pby93ZWJydGMtc3RhdHMvI2RvbS1ydGNtZWRpYXN0cmVhbXN0YXRzLXN0cmVhbWlkZW50aWZpZXJcblxuICAgIHZhciBvcmlnTG9jYWxEZXNjcmlwdGlvbiA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoXG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdsb2NhbERlc2NyaXB0aW9uJyk7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsXG4gICAgICAgICdsb2NhbERlc2NyaXB0aW9uJywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgICAgdmFyIGRlc2NyaXB0aW9uID0gb3JpZ0xvY2FsRGVzY3JpcHRpb24uZ2V0LmFwcGx5KHRoaXMpO1xuICAgICAgICAgICAgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICcnKSB7XG4gICAgICAgICAgICAgIHJldHVybiBkZXNjcmlwdGlvbjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXBsYWNlSW50ZXJuYWxTdHJlYW1JZChwYywgZGVzY3JpcHRpb24pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrID0gZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgaWYgKHBjLnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKFxuICAgICAgICAgICdUaGUgUlRDUGVlckNvbm5lY3Rpb25cXCdzIHNpZ25hbGluZ1N0YXRlIGlzIFxcJ2Nsb3NlZFxcJy4nLFxuICAgICAgICAgICdJbnZhbGlkU3RhdGVFcnJvcicpO1xuICAgICAgfVxuICAgICAgLy8gV2UgY2FuIG5vdCB5ZXQgY2hlY2sgZm9yIHNlbmRlciBpbnN0YW5jZW9mIFJUQ1J0cFNlbmRlclxuICAgICAgLy8gc2luY2Ugd2Ugc2hpbSBSVFBTZW5kZXIuIFNvIHdlIGNoZWNrIGlmIHNlbmRlci5fcGMgaXMgc2V0LlxuICAgICAgaWYgKCFzZW5kZXIuX3BjKSB7XG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ0FyZ3VtZW50IDEgb2YgUlRDUGVlckNvbm5lY3Rpb24ucmVtb3ZlVHJhY2sgJyArXG4gICAgICAgICAgICAnZG9lcyBub3QgaW1wbGVtZW50IGludGVyZmFjZSBSVENSdHBTZW5kZXIuJywgJ1R5cGVFcnJvcicpO1xuICAgICAgfVxuICAgICAgdmFyIGlzTG9jYWwgPSBzZW5kZXIuX3BjID09PSBwYztcbiAgICAgIGlmICghaXNMb2NhbCkge1xuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdTZW5kZXIgd2FzIG5vdCBjcmVhdGVkIGJ5IHRoaXMgY29ubmVjdGlvbi4nLFxuICAgICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpO1xuICAgICAgfVxuXG4gICAgICAvLyBTZWFyY2ggZm9yIHRoZSBuYXRpdmUgc3RyZWFtIHRoZSBzZW5kZXJzIHRyYWNrIGJlbG9uZ3MgdG8uXG4gICAgICBwYy5fc3RyZWFtcyA9IHBjLl9zdHJlYW1zIHx8IHt9O1xuICAgICAgdmFyIHN0cmVhbTtcbiAgICAgIE9iamVjdC5rZXlzKHBjLl9zdHJlYW1zKS5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbWlkKSB7XG4gICAgICAgIHZhciBoYXNUcmFjayA9IHBjLl9zdHJlYW1zW3N0cmVhbWlkXS5nZXRUcmFja3MoKS5maW5kKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgcmV0dXJuIHNlbmRlci50cmFjayA9PT0gdHJhY2s7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoaGFzVHJhY2spIHtcbiAgICAgICAgICBzdHJlYW0gPSBwYy5fc3RyZWFtc1tzdHJlYW1pZF07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBpZiAoc3RyZWFtKSB7XG4gICAgICAgIGlmIChzdHJlYW0uZ2V0VHJhY2tzKCkubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgLy8gaWYgdGhpcyBpcyB0aGUgbGFzdCB0cmFjayBvZiB0aGUgc3RyZWFtLCByZW1vdmUgdGhlIHN0cmVhbS4gVGhpc1xuICAgICAgICAgIC8vIHRha2VzIGNhcmUgb2YgYW55IHNoaW1tZWQgX3NlbmRlcnMuXG4gICAgICAgICAgcGMucmVtb3ZlU3RyZWFtKHBjLl9yZXZlcnNlU3RyZWFtc1tzdHJlYW0uaWRdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyByZWx5aW5nIG9uIHRoZSBzYW1lIG9kZCBjaHJvbWUgYmVoYXZpb3VyIGFzIGFib3ZlLlxuICAgICAgICAgIHN0cmVhbS5yZW1vdmVUcmFjayhzZW5kZXIudHJhY2spO1xuICAgICAgICB9XG4gICAgICAgIHBjLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWdvdGlhdGlvbm5lZWRlZCcpKTtcbiAgICAgIH1cbiAgICB9O1xuICB9LFxuXG4gIHNoaW1QZWVyQ29ubmVjdGlvbjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuXG4gICAgLy8gVGhlIFJUQ1BlZXJDb25uZWN0aW9uIG9iamVjdC5cbiAgICBpZiAoIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJiB3aW5kb3cud2Via2l0UlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKSB7XG4gICAgICAgIC8vIFRyYW5zbGF0ZSBpY2VUcmFuc3BvcnRQb2xpY3kgdG8gaWNlVHJhbnNwb3J0cyxcbiAgICAgICAgLy8gc2VlIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3Avd2VicnRjL2lzc3Vlcy9kZXRhaWw/aWQ9NDg2OVxuICAgICAgICAvLyB0aGlzIHdhcyBmaXhlZCBpbiBNNTYgYWxvbmcgd2l0aCB1bnByZWZpeGluZyBSVENQZWVyQ29ubmVjdGlvbi5cbiAgICAgICAgbG9nZ2luZygnUGVlckNvbm5lY3Rpb24nKTtcbiAgICAgICAgaWYgKHBjQ29uZmlnICYmIHBjQ29uZmlnLmljZVRyYW5zcG9ydFBvbGljeSkge1xuICAgICAgICAgIHBjQ29uZmlnLmljZVRyYW5zcG9ydHMgPSBwY0NvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3k7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IHdpbmRvdy53ZWJraXRSVENQZWVyQ29ubmVjdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cyk7XG4gICAgICB9O1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSA9XG4gICAgICAgICAgd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcbiAgICAgIC8vIHdyYXAgc3RhdGljIG1ldGhvZHMuIEN1cnJlbnRseSBqdXN0IGdlbmVyYXRlQ2VydGlmaWNhdGUuXG4gICAgICBpZiAod2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiwgJ2dlbmVyYXRlQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB3aW5kb3cud2Via2l0UlRDUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBtaWdyYXRlIGZyb20gbm9uLXNwZWMgUlRDSWNlU2VydmVyLnVybCB0byBSVENJY2VTZXJ2ZXIudXJsc1xuICAgICAgdmFyIE9yaWdQZWVyQ29ubmVjdGlvbiA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbjtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKSB7XG4gICAgICAgIGlmIChwY0NvbmZpZyAmJiBwY0NvbmZpZy5pY2VTZXJ2ZXJzKSB7XG4gICAgICAgICAgdmFyIG5ld0ljZVNlcnZlcnMgPSBbXTtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBjQ29uZmlnLmljZVNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBzZXJ2ZXIgPSBwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZXJ2ZXIuaGFzT3duUHJvcGVydHkoJ3VybHMnKSAmJlxuICAgICAgICAgICAgICAgIHNlcnZlci5oYXNPd25Qcm9wZXJ0eSgndXJsJykpIHtcbiAgICAgICAgICAgICAgdXRpbHMuZGVwcmVjYXRlZCgnUlRDSWNlU2VydmVyLnVybCcsICdSVENJY2VTZXJ2ZXIudXJscycpO1xuICAgICAgICAgICAgICBzZXJ2ZXIgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHNlcnZlcikpO1xuICAgICAgICAgICAgICBzZXJ2ZXIudXJscyA9IHNlcnZlci51cmw7XG4gICAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChzZXJ2ZXIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKHBjQ29uZmlnLmljZVNlcnZlcnNbaV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBwY0NvbmZpZy5pY2VTZXJ2ZXJzID0gbmV3SWNlU2VydmVycztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IE9yaWdQZWVyQ29ubmVjdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cyk7XG4gICAgICB9O1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSA9IE9yaWdQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG4gICAgICAvLyB3cmFwIHN0YXRpYyBtZXRob2RzLiBDdXJyZW50bHkganVzdCBnZW5lcmF0ZUNlcnRpZmljYXRlLlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiwgJ2dlbmVyYXRlQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIE9yaWdQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ0dldFN0YXRzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oc2VsZWN0b3IsXG4gICAgICAgIHN1Y2Nlc3NDYWxsYmFjaywgZXJyb3JDYWxsYmFjaykge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuXG4gICAgICAvLyBJZiBzZWxlY3RvciBpcyBhIGZ1bmN0aW9uIHRoZW4gd2UgYXJlIGluIHRoZSBvbGQgc3R5bGUgc3RhdHMgc28ganVzdFxuICAgICAgLy8gcGFzcyBiYWNrIHRoZSBvcmlnaW5hbCBnZXRTdGF0cyBmb3JtYXQgdG8gYXZvaWQgYnJlYWtpbmcgb2xkIHVzZXJzLlxuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAwICYmIHR5cGVvZiBzZWxlY3RvciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICByZXR1cm4gb3JpZ0dldFN0YXRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFdoZW4gc3BlYy1zdHlsZSBnZXRTdGF0cyBpcyBzdXBwb3J0ZWQsIHJldHVybiB0aG9zZSB3aGVuIGNhbGxlZCB3aXRoXG4gICAgICAvLyBlaXRoZXIgbm8gYXJndW1lbnRzIG9yIHRoZSBzZWxlY3RvciBhcmd1bWVudCBpcyBudWxsLlxuICAgICAgaWYgKG9yaWdHZXRTdGF0cy5sZW5ndGggPT09IDAgJiYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDAgfHxcbiAgICAgICAgICB0eXBlb2YgYXJndW1lbnRzWzBdICE9PSAnZnVuY3Rpb24nKSkge1xuICAgICAgICByZXR1cm4gb3JpZ0dldFN0YXRzLmFwcGx5KHRoaXMsIFtdKTtcbiAgICAgIH1cblxuICAgICAgdmFyIGZpeENocm9tZVN0YXRzXyA9IGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIHZhciBzdGFuZGFyZFJlcG9ydCA9IHt9O1xuICAgICAgICB2YXIgcmVwb3J0cyA9IHJlc3BvbnNlLnJlc3VsdCgpO1xuICAgICAgICByZXBvcnRzLmZvckVhY2goZnVuY3Rpb24ocmVwb3J0KSB7XG4gICAgICAgICAgdmFyIHN0YW5kYXJkU3RhdHMgPSB7XG4gICAgICAgICAgICBpZDogcmVwb3J0LmlkLFxuICAgICAgICAgICAgdGltZXN0YW1wOiByZXBvcnQudGltZXN0YW1wLFxuICAgICAgICAgICAgdHlwZToge1xuICAgICAgICAgICAgICBsb2NhbGNhbmRpZGF0ZTogJ2xvY2FsLWNhbmRpZGF0ZScsXG4gICAgICAgICAgICAgIHJlbW90ZWNhbmRpZGF0ZTogJ3JlbW90ZS1jYW5kaWRhdGUnXG4gICAgICAgICAgICB9W3JlcG9ydC50eXBlXSB8fCByZXBvcnQudHlwZVxuICAgICAgICAgIH07XG4gICAgICAgICAgcmVwb3J0Lm5hbWVzKCkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICAgICAgICBzdGFuZGFyZFN0YXRzW25hbWVdID0gcmVwb3J0LnN0YXQobmFtZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3RhbmRhcmRSZXBvcnRbc3RhbmRhcmRTdGF0cy5pZF0gPSBzdGFuZGFyZFN0YXRzO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gc3RhbmRhcmRSZXBvcnQ7XG4gICAgICB9O1xuXG4gICAgICAvLyBzaGltIGdldFN0YXRzIHdpdGggbWFwbGlrZSBzdXBwb3J0XG4gICAgICB2YXIgbWFrZU1hcFN0YXRzID0gZnVuY3Rpb24oc3RhdHMpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBNYXAoT2JqZWN0LmtleXMoc3RhdHMpLm1hcChmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgICByZXR1cm4gW2tleSwgc3RhdHNba2V5XV07XG4gICAgICAgIH0pKTtcbiAgICAgIH07XG5cbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID49IDIpIHtcbiAgICAgICAgdmFyIHN1Y2Nlc3NDYWxsYmFja1dyYXBwZXJfID0gZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICBhcmdzWzFdKG1ha2VNYXBTdGF0cyhmaXhDaHJvbWVTdGF0c18ocmVzcG9uc2UpKSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIG9yaWdHZXRTdGF0cy5hcHBseSh0aGlzLCBbc3VjY2Vzc0NhbGxiYWNrV3JhcHBlcl8sXG4gICAgICAgICAgYXJndW1lbnRzWzBdXSk7XG4gICAgICB9XG5cbiAgICAgIC8vIHByb21pc2Utc3VwcG9ydFxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICBvcmlnR2V0U3RhdHMuYXBwbHkocGMsIFtcbiAgICAgICAgICBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShtYWtlTWFwU3RhdHMoZml4Q2hyb21lU3RhdHNfKHJlc3BvbnNlKSkpO1xuICAgICAgICAgIH0sIHJlamVjdF0pO1xuICAgICAgfSkudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGVycm9yQ2FsbGJhY2spO1xuICAgIH07XG5cbiAgICAvLyBhZGQgcHJvbWlzZSBzdXBwb3J0IC0tIG5hdGl2ZWx5IGF2YWlsYWJsZSBpbiBDaHJvbWUgNTFcbiAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDUxKSB7XG4gICAgICBbJ3NldExvY2FsRGVzY3JpcHRpb24nLCAnc2V0UmVtb3RlRGVzY3JpcHRpb24nLCAnYWRkSWNlQ2FuZGlkYXRlJ11cbiAgICAgICAgICAuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgICAgIHZhciBuYXRpdmVNZXRob2QgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgICAgIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgICAgICAgICAgbmF0aXZlTWV0aG9kLmFwcGx5KHBjLCBbYXJnc1swXSwgcmVzb2x2ZSwgcmVqZWN0XSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPCAyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBhcmdzWzFdLmFwcGx5KG51bGwsIFtdKTtcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZnVuY3Rpb24oZXJyKSB7XG4gICAgICAgICAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID49IDMpIHtcbiAgICAgICAgICAgICAgICAgIGFyZ3NbMl0uYXBwbHkobnVsbCwgW2Vycl0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIHByb21pc2Ugc3VwcG9ydCBmb3IgY3JlYXRlT2ZmZXIgYW5kIGNyZWF0ZUFuc3dlci4gQXZhaWxhYmxlICh3aXRob3V0XG4gICAgLy8gYnVncykgc2luY2UgTTUyOiBjcmJ1Zy82MTkyODlcbiAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDUyKSB7XG4gICAgICBbJ2NyZWF0ZU9mZmVyJywgJ2NyZWF0ZUFuc3dlciddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgIHZhciBuYXRpdmVNZXRob2QgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxIHx8IChhcmd1bWVudHMubGVuZ3RoID09PSAxICYmXG4gICAgICAgICAgICAgIHR5cGVvZiBhcmd1bWVudHNbMF0gPT09ICdvYmplY3QnKSkge1xuICAgICAgICAgICAgdmFyIG9wdHMgPSBhcmd1bWVudHMubGVuZ3RoID09PSAxID8gYXJndW1lbnRzWzBdIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAgICAgICBuYXRpdmVNZXRob2QuYXBwbHkocGMsIFtyZXNvbHZlLCByZWplY3QsIG9wdHNdKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBzaGltIGltcGxpY2l0IGNyZWF0aW9uIG9mIFJUQ1Nlc3Npb25EZXNjcmlwdGlvbi9SVENJY2VDYW5kaWRhdGVcbiAgICBbJ3NldExvY2FsRGVzY3JpcHRpb24nLCAnc2V0UmVtb3RlRGVzY3JpcHRpb24nLCAnYWRkSWNlQ2FuZGlkYXRlJ11cbiAgICAgICAgLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgICAgdmFyIG5hdGl2ZU1ldGhvZCA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGFyZ3VtZW50c1swXSA9IG5ldyAoKG1ldGhvZCA9PT0gJ2FkZEljZUNhbmRpZGF0ZScpID9cbiAgICAgICAgICAgICAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlIDpcbiAgICAgICAgICAgICAgICB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKShhcmd1bWVudHNbMF0pO1xuICAgICAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuXG4gICAgLy8gc3VwcG9ydCBmb3IgYWRkSWNlQ2FuZGlkYXRlKG51bGwgb3IgdW5kZWZpbmVkKVxuICAgIHZhciBuYXRpdmVBZGRJY2VDYW5kaWRhdGUgPVxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCFhcmd1bWVudHNbMF0pIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50c1sxXSkge1xuICAgICAgICAgIGFyZ3VtZW50c1sxXS5hcHBseShudWxsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlQWRkSWNlQ2FuZGlkYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMuanMnKTtcbnZhciBsb2dnaW5nID0gdXRpbHMubG9nO1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHdpbmRvdykge1xuICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG4gIHZhciBuYXZpZ2F0b3IgPSB3aW5kb3cgJiYgd2luZG93Lm5hdmlnYXRvcjtcblxuICB2YXIgY29uc3RyYWludHNUb0Nocm9tZV8gPSBmdW5jdGlvbihjKSB7XG4gICAgaWYgKHR5cGVvZiBjICE9PSAnb2JqZWN0JyB8fCBjLm1hbmRhdG9yeSB8fCBjLm9wdGlvbmFsKSB7XG4gICAgICByZXR1cm4gYztcbiAgICB9XG4gICAgdmFyIGNjID0ge307XG4gICAgT2JqZWN0LmtleXMoYykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIGlmIChrZXkgPT09ICdyZXF1aXJlJyB8fCBrZXkgPT09ICdhZHZhbmNlZCcgfHwga2V5ID09PSAnbWVkaWFTb3VyY2UnKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciByID0gKHR5cGVvZiBjW2tleV0gPT09ICdvYmplY3QnKSA/IGNba2V5XSA6IHtpZGVhbDogY1trZXldfTtcbiAgICAgIGlmIChyLmV4YWN0ICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHIuZXhhY3QgPT09ICdudW1iZXInKSB7XG4gICAgICAgIHIubWluID0gci5tYXggPSByLmV4YWN0O1xuICAgICAgfVxuICAgICAgdmFyIG9sZG5hbWVfID0gZnVuY3Rpb24ocHJlZml4LCBuYW1lKSB7XG4gICAgICAgIGlmIChwcmVmaXgpIHtcbiAgICAgICAgICByZXR1cm4gcHJlZml4ICsgbmFtZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIG5hbWUuc2xpY2UoMSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIChuYW1lID09PSAnZGV2aWNlSWQnKSA/ICdzb3VyY2VJZCcgOiBuYW1lO1xuICAgICAgfTtcbiAgICAgIGlmIChyLmlkZWFsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY2Mub3B0aW9uYWwgPSBjYy5vcHRpb25hbCB8fCBbXTtcbiAgICAgICAgdmFyIG9jID0ge307XG4gICAgICAgIGlmICh0eXBlb2Ygci5pZGVhbCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBvY1tvbGRuYW1lXygnbWluJywga2V5KV0gPSByLmlkZWFsO1xuICAgICAgICAgIGNjLm9wdGlvbmFsLnB1c2gob2MpO1xuICAgICAgICAgIG9jID0ge307XG4gICAgICAgICAgb2Nbb2xkbmFtZV8oJ21heCcsIGtleSldID0gci5pZGVhbDtcbiAgICAgICAgICBjYy5vcHRpb25hbC5wdXNoKG9jKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvY1tvbGRuYW1lXygnJywga2V5KV0gPSByLmlkZWFsO1xuICAgICAgICAgIGNjLm9wdGlvbmFsLnB1c2gob2MpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoci5leGFjdCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByLmV4YWN0ICE9PSAnbnVtYmVyJykge1xuICAgICAgICBjYy5tYW5kYXRvcnkgPSBjYy5tYW5kYXRvcnkgfHwge307XG4gICAgICAgIGNjLm1hbmRhdG9yeVtvbGRuYW1lXygnJywga2V5KV0gPSByLmV4YWN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgWydtaW4nLCAnbWF4J10uZm9yRWFjaChmdW5jdGlvbihtaXgpIHtcbiAgICAgICAgICBpZiAoclttaXhdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNjLm1hbmRhdG9yeSA9IGNjLm1hbmRhdG9yeSB8fCB7fTtcbiAgICAgICAgICAgIGNjLm1hbmRhdG9yeVtvbGRuYW1lXyhtaXgsIGtleSldID0gclttaXhdO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGMuYWR2YW5jZWQpIHtcbiAgICAgIGNjLm9wdGlvbmFsID0gKGNjLm9wdGlvbmFsIHx8IFtdKS5jb25jYXQoYy5hZHZhbmNlZCk7XG4gICAgfVxuICAgIHJldHVybiBjYztcbiAgfTtcblxuICB2YXIgc2hpbUNvbnN0cmFpbnRzXyA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzLCBmdW5jKSB7XG4gICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPj0gNjEpIHtcbiAgICAgIHJldHVybiBmdW5jKGNvbnN0cmFpbnRzKTtcbiAgICB9XG4gICAgY29uc3RyYWludHMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgaWYgKGNvbnN0cmFpbnRzICYmIHR5cGVvZiBjb25zdHJhaW50cy5hdWRpbyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciByZW1hcCA9IGZ1bmN0aW9uKG9iaiwgYSwgYikge1xuICAgICAgICBpZiAoYSBpbiBvYmogJiYgIShiIGluIG9iaikpIHtcbiAgICAgICAgICBvYmpbYl0gPSBvYmpbYV07XG4gICAgICAgICAgZGVsZXRlIG9ialthXTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0cmFpbnRzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgICAgcmVtYXAoY29uc3RyYWludHMuYXVkaW8sICdhdXRvR2FpbkNvbnRyb2wnLCAnZ29vZ0F1dG9HYWluQ29udHJvbCcpO1xuICAgICAgcmVtYXAoY29uc3RyYWludHMuYXVkaW8sICdub2lzZVN1cHByZXNzaW9uJywgJ2dvb2dOb2lzZVN1cHByZXNzaW9uJyk7XG4gICAgICBjb25zdHJhaW50cy5hdWRpbyA9IGNvbnN0cmFpbnRzVG9DaHJvbWVfKGNvbnN0cmFpbnRzLmF1ZGlvKTtcbiAgICB9XG4gICAgaWYgKGNvbnN0cmFpbnRzICYmIHR5cGVvZiBjb25zdHJhaW50cy52aWRlbyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIFNoaW0gZmFjaW5nTW9kZSBmb3IgbW9iaWxlICYgc3VyZmFjZSBwcm8uXG4gICAgICB2YXIgZmFjZSA9IGNvbnN0cmFpbnRzLnZpZGVvLmZhY2luZ01vZGU7XG4gICAgICBmYWNlID0gZmFjZSAmJiAoKHR5cGVvZiBmYWNlID09PSAnb2JqZWN0JykgPyBmYWNlIDoge2lkZWFsOiBmYWNlfSk7XG4gICAgICB2YXIgZ2V0U3VwcG9ydGVkRmFjaW5nTW9kZUxpZXMgPSBicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNjY7XG5cbiAgICAgIGlmICgoZmFjZSAmJiAoZmFjZS5leGFjdCA9PT0gJ3VzZXInIHx8IGZhY2UuZXhhY3QgPT09ICdlbnZpcm9ubWVudCcgfHxcbiAgICAgICAgICAgICAgICAgICAgZmFjZS5pZGVhbCA9PT0gJ3VzZXInIHx8IGZhY2UuaWRlYWwgPT09ICdlbnZpcm9ubWVudCcpKSAmJlxuICAgICAgICAgICEobmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRTdXBwb3J0ZWRDb25zdHJhaW50cyAmJlxuICAgICAgICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRTdXBwb3J0ZWRDb25zdHJhaW50cygpLmZhY2luZ01vZGUgJiZcbiAgICAgICAgICAgICFnZXRTdXBwb3J0ZWRGYWNpbmdNb2RlTGllcykpIHtcbiAgICAgICAgZGVsZXRlIGNvbnN0cmFpbnRzLnZpZGVvLmZhY2luZ01vZGU7XG4gICAgICAgIHZhciBtYXRjaGVzO1xuICAgICAgICBpZiAoZmFjZS5leGFjdCA9PT0gJ2Vudmlyb25tZW50JyB8fCBmYWNlLmlkZWFsID09PSAnZW52aXJvbm1lbnQnKSB7XG4gICAgICAgICAgbWF0Y2hlcyA9IFsnYmFjaycsICdyZWFyJ107XG4gICAgICAgIH0gZWxzZSBpZiAoZmFjZS5leGFjdCA9PT0gJ3VzZXInIHx8IGZhY2UuaWRlYWwgPT09ICd1c2VyJykge1xuICAgICAgICAgIG1hdGNoZXMgPSBbJ2Zyb250J107XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICAvLyBMb29rIGZvciBtYXRjaGVzIGluIGxhYmVsLCBvciB1c2UgbGFzdCBjYW0gZm9yIGJhY2sgKHR5cGljYWwpLlxuICAgICAgICAgIHJldHVybiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmVudW1lcmF0ZURldmljZXMoKVxuICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKGRldmljZXMpIHtcbiAgICAgICAgICAgIGRldmljZXMgPSBkZXZpY2VzLmZpbHRlcihmdW5jdGlvbihkKSB7XG4gICAgICAgICAgICAgIHJldHVybiBkLmtpbmQgPT09ICd2aWRlb2lucHV0JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdmFyIGRldiA9IGRldmljZXMuZmluZChmdW5jdGlvbihkKSB7XG4gICAgICAgICAgICAgIHJldHVybiBtYXRjaGVzLnNvbWUoZnVuY3Rpb24obWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZC5sYWJlbC50b0xvd2VyQ2FzZSgpLmluZGV4T2YobWF0Y2gpICE9PSAtMTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmICghZGV2ICYmIGRldmljZXMubGVuZ3RoICYmIG1hdGNoZXMuaW5kZXhPZignYmFjaycpICE9PSAtMSkge1xuICAgICAgICAgICAgICBkZXYgPSBkZXZpY2VzW2RldmljZXMubGVuZ3RoIC0gMV07IC8vIG1vcmUgbGlrZWx5IHRoZSBiYWNrIGNhbVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRldikge1xuICAgICAgICAgICAgICBjb25zdHJhaW50cy52aWRlby5kZXZpY2VJZCA9IGZhY2UuZXhhY3QgPyB7ZXhhY3Q6IGRldi5kZXZpY2VJZH0gOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7aWRlYWw6IGRldi5kZXZpY2VJZH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdHJhaW50cy52aWRlbyA9IGNvbnN0cmFpbnRzVG9DaHJvbWVfKGNvbnN0cmFpbnRzLnZpZGVvKTtcbiAgICAgICAgICAgIGxvZ2dpbmcoJ2Nocm9tZTogJyArIEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgICAgICAgICByZXR1cm4gZnVuYyhjb25zdHJhaW50cyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0cmFpbnRzLnZpZGVvID0gY29uc3RyYWludHNUb0Nocm9tZV8oY29uc3RyYWludHMudmlkZW8pO1xuICAgIH1cbiAgICBsb2dnaW5nKCdjaHJvbWU6ICcgKyBKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgIHJldHVybiBmdW5jKGNvbnN0cmFpbnRzKTtcbiAgfTtcblxuICB2YXIgc2hpbUVycm9yXyA9IGZ1bmN0aW9uKGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZToge1xuICAgICAgICBQZXJtaXNzaW9uRGVuaWVkRXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBQZXJtaXNzaW9uRGlzbWlzc2VkRXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBJbnZhbGlkU3RhdGVFcnJvcjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIERldmljZXNOb3RGb3VuZEVycm9yOiAnTm90Rm91bmRFcnJvcicsXG4gICAgICAgIENvbnN0cmFpbnROb3RTYXRpc2ZpZWRFcnJvcjogJ092ZXJjb25zdHJhaW5lZEVycm9yJyxcbiAgICAgICAgVHJhY2tTdGFydEVycm9yOiAnTm90UmVhZGFibGVFcnJvcicsXG4gICAgICAgIE1lZGlhRGV2aWNlRmFpbGVkRHVlVG9TaHV0ZG93bjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIE1lZGlhRGV2aWNlS2lsbFN3aXRjaE9uOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgVGFiQ2FwdHVyZUVycm9yOiAnQWJvcnRFcnJvcicsXG4gICAgICAgIFNjcmVlbkNhcHR1cmVFcnJvcjogJ0Fib3J0RXJyb3InLFxuICAgICAgICBEZXZpY2VDYXB0dXJlRXJyb3I6ICdBYm9ydEVycm9yJ1xuICAgICAgfVtlLm5hbWVdIHx8IGUubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGUubWVzc2FnZSxcbiAgICAgIGNvbnN0cmFpbnQ6IGUuY29uc3RyYWludE5hbWUsXG4gICAgICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm5hbWUgKyAodGhpcy5tZXNzYWdlICYmICc6ICcpICsgdGhpcy5tZXNzYWdlO1xuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgdmFyIGdldFVzZXJNZWRpYV8gPSBmdW5jdGlvbihjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkVycm9yKSB7XG4gICAgc2hpbUNvbnN0cmFpbnRzXyhjb25zdHJhaW50cywgZnVuY3Rpb24oYykge1xuICAgICAgbmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYShjLCBvblN1Y2Nlc3MsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKG9uRXJyb3IpIHtcbiAgICAgICAgICBvbkVycm9yKHNoaW1FcnJvcl8oZSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhID0gZ2V0VXNlck1lZGlhXztcblxuICAvLyBSZXR1cm5zIHRoZSByZXN1bHQgb2YgZ2V0VXNlck1lZGlhIGFzIGEgUHJvbWlzZS5cbiAgdmFyIGdldFVzZXJNZWRpYVByb21pc2VfID0gZnVuY3Rpb24oY29uc3RyYWludHMpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzLCByZXNvbHZlLCByZWplY3QpO1xuICAgIH0pO1xuICB9O1xuXG4gIGlmICghbmF2aWdhdG9yLm1lZGlhRGV2aWNlcykge1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMgPSB7XG4gICAgICBnZXRVc2VyTWVkaWE6IGdldFVzZXJNZWRpYVByb21pc2VfLFxuICAgICAgZW51bWVyYXRlRGV2aWNlczogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgdmFyIGtpbmRzID0ge2F1ZGlvOiAnYXVkaW9pbnB1dCcsIHZpZGVvOiAndmlkZW9pbnB1dCd9O1xuICAgICAgICAgIHJldHVybiB3aW5kb3cuTWVkaWFTdHJlYW1UcmFjay5nZXRTb3VyY2VzKGZ1bmN0aW9uKGRldmljZXMpIHtcbiAgICAgICAgICAgIHJlc29sdmUoZGV2aWNlcy5tYXAoZnVuY3Rpb24oZGV2aWNlKSB7XG4gICAgICAgICAgICAgIHJldHVybiB7bGFiZWw6IGRldmljZS5sYWJlbCxcbiAgICAgICAgICAgICAgICBraW5kOiBraW5kc1tkZXZpY2Uua2luZF0sXG4gICAgICAgICAgICAgICAgZGV2aWNlSWQ6IGRldmljZS5pZCxcbiAgICAgICAgICAgICAgICBncm91cElkOiAnJ307XG4gICAgICAgICAgICB9KSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIGdldFN1cHBvcnRlZENvbnN0cmFpbnRzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZXZpY2VJZDogdHJ1ZSwgZWNob0NhbmNlbGxhdGlvbjogdHJ1ZSwgZmFjaW5nTW9kZTogdHJ1ZSxcbiAgICAgICAgICBmcmFtZVJhdGU6IHRydWUsIGhlaWdodDogdHJ1ZSwgd2lkdGg6IHRydWVcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gQSBzaGltIGZvciBnZXRVc2VyTWVkaWEgbWV0aG9kIG9uIHRoZSBtZWRpYURldmljZXMgb2JqZWN0LlxuICAvLyBUT0RPKEthcHRlbkphbnNzb24pIHJlbW92ZSBvbmNlIGltcGxlbWVudGVkIGluIENocm9tZSBzdGFibGUuXG4gIGlmICghbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEpIHtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzKSB7XG4gICAgICByZXR1cm4gZ2V0VXNlck1lZGlhUHJvbWlzZV8oY29uc3RyYWludHMpO1xuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgLy8gRXZlbiB0aG91Z2ggQ2hyb21lIDQ1IGhhcyBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzIGFuZCBhIGdldFVzZXJNZWRpYVxuICAgIC8vIGZ1bmN0aW9uIHdoaWNoIHJldHVybnMgYSBQcm9taXNlLCBpdCBkb2VzIG5vdCBhY2NlcHQgc3BlYy1zdHlsZVxuICAgIC8vIGNvbnN0cmFpbnRzLlxuICAgIHZhciBvcmlnR2V0VXNlck1lZGlhID0gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEuXG4gICAgICAgIGJpbmQobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyk7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjcykge1xuICAgICAgcmV0dXJuIHNoaW1Db25zdHJhaW50c18oY3MsIGZ1bmN0aW9uKGMpIHtcbiAgICAgICAgcmV0dXJuIG9yaWdHZXRVc2VyTWVkaWEoYykudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICBpZiAoYy5hdWRpbyAmJiAhc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkubGVuZ3RoIHx8XG4gICAgICAgICAgICAgIGMudmlkZW8gJiYgIXN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmxlbmd0aCkge1xuICAgICAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgICAgdHJhY2suc3RvcCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCcnLCAnTm90Rm91bmRFcnJvcicpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gc3RyZWFtO1xuICAgICAgICB9LCBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHNoaW1FcnJvcl8oZSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cblxuICAvLyBEdW1teSBkZXZpY2VjaGFuZ2UgZXZlbnQgbWV0aG9kcy5cbiAgLy8gVE9ETyhLYXB0ZW5KYW5zc29uKSByZW1vdmUgb25jZSBpbXBsZW1lbnRlZCBpbiBDaHJvbWUgc3RhYmxlLlxuICBpZiAodHlwZW9mIG5hdmlnYXRvci5tZWRpYURldmljZXMuYWRkRXZlbnRMaXN0ZW5lciA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmFkZEV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIGxvZ2dpbmcoJ0R1bW15IG1lZGlhRGV2aWNlcy5hZGRFdmVudExpc3RlbmVyIGNhbGxlZC4nKTtcbiAgICB9O1xuICB9XG4gIGlmICh0eXBlb2YgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5yZW1vdmVFdmVudExpc3RlbmVyID09PSAndW5kZWZpbmVkJykge1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKCkge1xuICAgICAgbG9nZ2luZygnRHVtbXkgbWVkaWFEZXZpY2VzLnJlbW92ZUV2ZW50TGlzdGVuZXIgY2FsbGVkLicpO1xuICAgIH07XG4gIH1cbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNyBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIFNEUFV0aWxzID0gcmVxdWlyZSgnc2RwJyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzaGltUlRDSWNlQ2FuZGlkYXRlOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBmb3VuZGF0aW9uIGlzIGFyYml0cmFyaWx5IGNob3NlbiBhcyBhbiBpbmRpY2F0b3IgZm9yIGZ1bGwgc3VwcG9ydCBmb3JcbiAgICAvLyBodHRwczovL3czYy5naXRodWIuaW8vd2VicnRjLXBjLyNydGNpY2VjYW5kaWRhdGUtaW50ZXJmYWNlXG4gICAgaWYgKCF3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlIHx8ICh3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlICYmICdmb3VuZGF0aW9uJyBpblxuICAgICAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlLnByb3RvdHlwZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgTmF0aXZlUlRDSWNlQ2FuZGlkYXRlID0gd2luZG93LlJUQ0ljZUNhbmRpZGF0ZTtcbiAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlID0gZnVuY3Rpb24oYXJncykge1xuICAgICAgLy8gUmVtb3ZlIHRoZSBhPSB3aGljaCBzaG91bGRuJ3QgYmUgcGFydCBvZiB0aGUgY2FuZGlkYXRlIHN0cmluZy5cbiAgICAgIGlmICh0eXBlb2YgYXJncyA9PT0gJ29iamVjdCcgJiYgYXJncy5jYW5kaWRhdGUgJiZcbiAgICAgICAgICBhcmdzLmNhbmRpZGF0ZS5pbmRleE9mKCdhPScpID09PSAwKSB7XG4gICAgICAgIGFyZ3MgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGFyZ3MpKTtcbiAgICAgICAgYXJncy5jYW5kaWRhdGUgPSBhcmdzLmNhbmRpZGF0ZS5zdWJzdHIoMik7XG4gICAgICB9XG5cbiAgICAgIGlmIChhcmdzLmNhbmRpZGF0ZSAmJiBhcmdzLmNhbmRpZGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgLy8gQXVnbWVudCB0aGUgbmF0aXZlIGNhbmRpZGF0ZSB3aXRoIHRoZSBwYXJzZWQgZmllbGRzLlxuICAgICAgICB2YXIgbmF0aXZlQ2FuZGlkYXRlID0gbmV3IE5hdGl2ZVJUQ0ljZUNhbmRpZGF0ZShhcmdzKTtcbiAgICAgICAgdmFyIHBhcnNlZENhbmRpZGF0ZSA9IFNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlKGFyZ3MuY2FuZGlkYXRlKTtcbiAgICAgICAgdmFyIGF1Z21lbnRlZENhbmRpZGF0ZSA9IE9iamVjdC5hc3NpZ24obmF0aXZlQ2FuZGlkYXRlLFxuICAgICAgICAgICAgcGFyc2VkQ2FuZGlkYXRlKTtcblxuICAgICAgICAvLyBBZGQgYSBzZXJpYWxpemVyIHRoYXQgZG9lcyBub3Qgc2VyaWFsaXplIHRoZSBleHRyYSBhdHRyaWJ1dGVzLlxuICAgICAgICBhdWdtZW50ZWRDYW5kaWRhdGUudG9KU09OID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNhbmRpZGF0ZTogYXVnbWVudGVkQ2FuZGlkYXRlLmNhbmRpZGF0ZSxcbiAgICAgICAgICAgIHNkcE1pZDogYXVnbWVudGVkQ2FuZGlkYXRlLnNkcE1pZCxcbiAgICAgICAgICAgIHNkcE1MaW5lSW5kZXg6IGF1Z21lbnRlZENhbmRpZGF0ZS5zZHBNTGluZUluZGV4LFxuICAgICAgICAgICAgdXNlcm5hbWVGcmFnbWVudDogYXVnbWVudGVkQ2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQsXG4gICAgICAgICAgfTtcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIGF1Z21lbnRlZENhbmRpZGF0ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgTmF0aXZlUlRDSWNlQ2FuZGlkYXRlKGFyZ3MpO1xuICAgIH07XG4gICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZS5wcm90b3R5cGUgPSBOYXRpdmVSVENJY2VDYW5kaWRhdGUucHJvdG90eXBlO1xuXG4gICAgLy8gSG9vayB1cCB0aGUgYXVnbWVudGVkIGNhbmRpZGF0ZSBpbiBvbmljZWNhbmRpZGF0ZSBhbmRcbiAgICAvLyBhZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCAuLi4pXG4gICAgdXRpbHMud3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCAnaWNlY2FuZGlkYXRlJywgZnVuY3Rpb24oZSkge1xuICAgICAgaWYgKGUuY2FuZGlkYXRlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShlLCAnY2FuZGlkYXRlJywge1xuICAgICAgICAgIHZhbHVlOiBuZXcgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZShlLmNhbmRpZGF0ZSksXG4gICAgICAgICAgd3JpdGFibGU6ICdmYWxzZSdcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBzaGltQ3JlYXRlT2JqZWN0VVJMIG11c3QgYmUgY2FsbGVkIGJlZm9yZSBzaGltU291cmNlT2JqZWN0IHRvIGF2b2lkIGxvb3AuXG5cbiAgc2hpbUNyZWF0ZU9iamVjdFVSTDogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIFVSTCA9IHdpbmRvdyAmJiB3aW5kb3cuVVJMO1xuXG4gICAgaWYgKCEodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LkhUTUxNZWRpYUVsZW1lbnQgJiZcbiAgICAgICAgICAnc3JjT2JqZWN0JyBpbiB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUgJiZcbiAgICAgICAgVVJMLmNyZWF0ZU9iamVjdFVSTCAmJiBVUkwucmV2b2tlT2JqZWN0VVJMKSkge1xuICAgICAgLy8gT25seSBzaGltIENyZWF0ZU9iamVjdFVSTCB1c2luZyBzcmNPYmplY3QgaWYgc3JjT2JqZWN0IGV4aXN0cy5cbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdmFyIG5hdGl2ZUNyZWF0ZU9iamVjdFVSTCA9IFVSTC5jcmVhdGVPYmplY3RVUkwuYmluZChVUkwpO1xuICAgIHZhciBuYXRpdmVSZXZva2VPYmplY3RVUkwgPSBVUkwucmV2b2tlT2JqZWN0VVJMLmJpbmQoVVJMKTtcbiAgICB2YXIgc3RyZWFtcyA9IG5ldyBNYXAoKSwgbmV3SWQgPSAwO1xuXG4gICAgVVJMLmNyZWF0ZU9iamVjdFVSTCA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgaWYgKCdnZXRUcmFja3MnIGluIHN0cmVhbSkge1xuICAgICAgICB2YXIgdXJsID0gJ3BvbHlibG9iOicgKyAoKytuZXdJZCk7XG4gICAgICAgIHN0cmVhbXMuc2V0KHVybCwgc3RyZWFtKTtcbiAgICAgICAgdXRpbHMuZGVwcmVjYXRlZCgnVVJMLmNyZWF0ZU9iamVjdFVSTChzdHJlYW0pJyxcbiAgICAgICAgICAgICdlbGVtLnNyY09iamVjdCA9IHN0cmVhbScpO1xuICAgICAgICByZXR1cm4gdXJsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZUNyZWF0ZU9iamVjdFVSTChzdHJlYW0pO1xuICAgIH07XG4gICAgVVJMLnJldm9rZU9iamVjdFVSTCA9IGZ1bmN0aW9uKHVybCkge1xuICAgICAgbmF0aXZlUmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgICBzdHJlYW1zLmRlbGV0ZSh1cmwpO1xuICAgIH07XG5cbiAgICB2YXIgZHNjID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NyYycpO1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUsICdzcmMnLCB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gZHNjLmdldC5hcHBseSh0aGlzKTtcbiAgICAgIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHVybCkge1xuICAgICAgICB0aGlzLnNyY09iamVjdCA9IHN0cmVhbXMuZ2V0KHVybCkgfHwgbnVsbDtcbiAgICAgICAgcmV0dXJuIGRzYy5zZXQuYXBwbHkodGhpcywgW3VybF0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdmFyIG5hdGl2ZVNldEF0dHJpYnV0ZSA9IHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZS5zZXRBdHRyaWJ1dGU7XG4gICAgd2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLnNldEF0dHJpYnV0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDIgJiZcbiAgICAgICAgICAoJycgKyBhcmd1bWVudHNbMF0pLnRvTG93ZXJDYXNlKCkgPT09ICdzcmMnKSB7XG4gICAgICAgIHRoaXMuc3JjT2JqZWN0ID0gc3RyZWFtcy5nZXQoYXJndW1lbnRzWzFdKSB8fCBudWxsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZVNldEF0dHJpYnV0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbU1heE1lc3NhZ2VTaXplOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAod2luZG93LlJUQ1NjdHBUcmFuc3BvcnQgfHwgIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG5cbiAgICBpZiAoISgnc2N0cCcgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnc2N0cCcsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHRoaXMuX3NjdHAgPT09ICd1bmRlZmluZWQnID8gbnVsbCA6IHRoaXMuX3NjdHA7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHZhciBzY3RwSW5EZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgICB2YXIgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGRlc2NyaXB0aW9uLnNkcCk7XG4gICAgICBzZWN0aW9ucy5zaGlmdCgpO1xuICAgICAgcmV0dXJuIHNlY3Rpb25zLnNvbWUoZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gICAgICAgIHZhciBtTGluZSA9IFNEUFV0aWxzLnBhcnNlTUxpbmUobWVkaWFTZWN0aW9uKTtcbiAgICAgICAgcmV0dXJuIG1MaW5lICYmIG1MaW5lLmtpbmQgPT09ICdhcHBsaWNhdGlvbidcbiAgICAgICAgICAgICYmIG1MaW5lLnByb3RvY29sLmluZGV4T2YoJ1NDVFAnKSAhPT0gLTE7XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgdmFyIGdldFJlbW90ZUZpcmVmb3hWZXJzaW9uID0gZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICAgIC8vIFRPRE86IElzIHRoZXJlIGEgYmV0dGVyIHNvbHV0aW9uIGZvciBkZXRlY3RpbmcgRmlyZWZveD9cbiAgICAgIHZhciBtYXRjaCA9IGRlc2NyaXB0aW9uLnNkcC5tYXRjaCgvbW96aWxsYS4uLlRISVNfSVNfU0RQQVJUQS0oXFxkKykvKTtcbiAgICAgIGlmIChtYXRjaCA9PT0gbnVsbCB8fCBtYXRjaC5sZW5ndGggPCAyKSB7XG4gICAgICAgIHJldHVybiAtMTtcbiAgICAgIH1cbiAgICAgIHZhciB2ZXJzaW9uID0gcGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcbiAgICAgIC8vIFRlc3QgZm9yIE5hTiAoeWVzLCB0aGlzIGlzIHVnbHkpXG4gICAgICByZXR1cm4gdmVyc2lvbiAhPT0gdmVyc2lvbiA/IC0xIDogdmVyc2lvbjtcbiAgICB9O1xuXG4gICAgdmFyIGdldENhblNlbmRNYXhNZXNzYWdlU2l6ZSA9IGZ1bmN0aW9uKHJlbW90ZUlzRmlyZWZveCkge1xuICAgICAgLy8gRXZlcnkgaW1wbGVtZW50YXRpb24gd2Uga25vdyBjYW4gc2VuZCBhdCBsZWFzdCA2NCBLaUIuXG4gICAgICAvLyBOb3RlOiBBbHRob3VnaCBDaHJvbWUgaXMgdGVjaG5pY2FsbHkgYWJsZSB0byBzZW5kIHVwIHRvIDI1NiBLaUIsIHRoZVxuICAgICAgLy8gICAgICAgZGF0YSBkb2VzIG5vdCByZWFjaCB0aGUgb3RoZXIgcGVlciByZWxpYWJseS5cbiAgICAgIC8vICAgICAgIFNlZTogaHR0cHM6Ly9idWdzLmNocm9taXVtLm9yZy9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTg0MTlcbiAgICAgIHZhciBjYW5TZW5kTWF4TWVzc2FnZVNpemUgPSA2NTUzNjtcbiAgICAgIGlmIChicm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA1Nykge1xuICAgICAgICAgIGlmIChyZW1vdGVJc0ZpcmVmb3ggPT09IC0xKSB7XG4gICAgICAgICAgICAvLyBGRiA8IDU3IHdpbGwgc2VuZCBpbiAxNiBLaUIgY2h1bmtzIHVzaW5nIHRoZSBkZXByZWNhdGVkIFBQSURcbiAgICAgICAgICAgIC8vIGZyYWdtZW50YXRpb24uXG4gICAgICAgICAgICBjYW5TZW5kTWF4TWVzc2FnZVNpemUgPSAxNjM4NDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gSG93ZXZlciwgb3RoZXIgRkYgKGFuZCBSQVdSVEMpIGNhbiByZWFzc2VtYmxlIFBQSUQtZnJhZ21lbnRlZFxuICAgICAgICAgICAgLy8gbWVzc2FnZXMuIFRodXMsIHN1cHBvcnRpbmcgfjIgR2lCIHdoZW4gc2VuZGluZy5cbiAgICAgICAgICAgIGNhblNlbmRNYXhNZXNzYWdlU2l6ZSA9IDIxNDc0ODM2Mzc7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA2MCkge1xuICAgICAgICAgIC8vIEN1cnJlbnRseSwgYWxsIEZGID49IDU3IHdpbGwgcmVzZXQgdGhlIHJlbW90ZSBtYXhpbXVtIG1lc3NhZ2Ugc2l6ZVxuICAgICAgICAgIC8vIHRvIHRoZSBkZWZhdWx0IHZhbHVlIHdoZW4gYSBkYXRhIGNoYW5uZWwgaXMgY3JlYXRlZCBhdCBhIGxhdGVyXG4gICAgICAgICAgLy8gc3RhZ2UuIDooXG4gICAgICAgICAgLy8gU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNDI2ODMxXG4gICAgICAgICAgY2FuU2VuZE1heE1lc3NhZ2VTaXplID1cbiAgICAgICAgICAgIGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPT09IDU3ID8gNjU1MzUgOiA2NTUzNjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGRiA+PSA2MCBzdXBwb3J0cyBzZW5kaW5nIH4yIEdpQlxuICAgICAgICAgIGNhblNlbmRNYXhNZXNzYWdlU2l6ZSA9IDIxNDc0ODM2Mzc7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBjYW5TZW5kTWF4TWVzc2FnZVNpemU7XG4gICAgfTtcblxuICAgIHZhciBnZXRNYXhNZXNzYWdlU2l6ZSA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uLCByZW1vdGVJc0ZpcmVmb3gpIHtcbiAgICAgIC8vIE5vdGU6IDY1NTM2IGJ5dGVzIGlzIHRoZSBkZWZhdWx0IHZhbHVlIGZyb20gdGhlIFNEUCBzcGVjLiBBbHNvLFxuICAgICAgLy8gICAgICAgZXZlcnkgaW1wbGVtZW50YXRpb24gd2Uga25vdyBzdXBwb3J0cyByZWNlaXZpbmcgNjU1MzYgYnl0ZXMuXG4gICAgICB2YXIgbWF4TWVzc2FnZVNpemUgPSA2NTUzNjtcblxuICAgICAgLy8gRkYgNTcgaGFzIGEgc2xpZ2h0bHkgaW5jb3JyZWN0IGRlZmF1bHQgcmVtb3RlIG1heCBtZXNzYWdlIHNpemUsIHNvXG4gICAgICAvLyB3ZSBuZWVkIHRvIGFkanVzdCBpdCBoZXJlIHRvIGF2b2lkIGEgZmFpbHVyZSB3aGVuIHNlbmRpbmcuXG4gICAgICAvLyBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTE0MjU2OTdcbiAgICAgIGlmIChicm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCdcbiAgICAgICAgICAgJiYgYnJvd3NlckRldGFpbHMudmVyc2lvbiA9PT0gNTcpIHtcbiAgICAgICAgbWF4TWVzc2FnZVNpemUgPSA2NTUzNTtcbiAgICAgIH1cblxuICAgICAgdmFyIG1hdGNoID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoZGVzY3JpcHRpb24uc2RwLCAnYT1tYXgtbWVzc2FnZS1zaXplOicpO1xuICAgICAgaWYgKG1hdGNoLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbWF4TWVzc2FnZVNpemUgPSBwYXJzZUludChtYXRjaFswXS5zdWJzdHIoMTkpLCAxMCk7XG4gICAgICB9IGVsc2UgaWYgKGJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94JyAmJlxuICAgICAgICAgICAgICAgICAgcmVtb3RlSXNGaXJlZm94ICE9PSAtMSkge1xuICAgICAgICAvLyBJZiB0aGUgbWF4aW11bSBtZXNzYWdlIHNpemUgaXMgbm90IHByZXNlbnQgaW4gdGhlIHJlbW90ZSBTRFAgYW5kXG4gICAgICAgIC8vIGJvdGggbG9jYWwgYW5kIHJlbW90ZSBhcmUgRmlyZWZveCwgdGhlIHJlbW90ZSBwZWVyIGNhbiByZWNlaXZlXG4gICAgICAgIC8vIH4yIEdpQi5cbiAgICAgICAgbWF4TWVzc2FnZVNpemUgPSAyMTQ3NDgzNjM3O1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1heE1lc3NhZ2VTaXplO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ1NldFJlbW90ZURlc2NyaXB0aW9uID1cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbjtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgcGMuX3NjdHAgPSBudWxsO1xuXG4gICAgICBpZiAoc2N0cEluRGVzY3JpcHRpb24oYXJndW1lbnRzWzBdKSkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgcmVtb3RlIGlzIEZGLlxuICAgICAgICB2YXIgaXNGaXJlZm94ID0gZ2V0UmVtb3RlRmlyZWZveFZlcnNpb24oYXJndW1lbnRzWzBdKTtcblxuICAgICAgICAvLyBHZXQgdGhlIG1heGltdW0gbWVzc2FnZSBzaXplIHRoZSBsb2NhbCBwZWVyIGlzIGNhcGFibGUgb2Ygc2VuZGluZ1xuICAgICAgICB2YXIgY2FuU2VuZE1NUyA9IGdldENhblNlbmRNYXhNZXNzYWdlU2l6ZShpc0ZpcmVmb3gpO1xuXG4gICAgICAgIC8vIEdldCB0aGUgbWF4aW11bSBtZXNzYWdlIHNpemUgb2YgdGhlIHJlbW90ZSBwZWVyLlxuICAgICAgICB2YXIgcmVtb3RlTU1TID0gZ2V0TWF4TWVzc2FnZVNpemUoYXJndW1lbnRzWzBdLCBpc0ZpcmVmb3gpO1xuXG4gICAgICAgIC8vIERldGVybWluZSBmaW5hbCBtYXhpbXVtIG1lc3NhZ2Ugc2l6ZVxuICAgICAgICB2YXIgbWF4TWVzc2FnZVNpemU7XG4gICAgICAgIGlmIChjYW5TZW5kTU1TID09PSAwICYmIHJlbW90ZU1NUyA9PT0gMCkge1xuICAgICAgICAgIG1heE1lc3NhZ2VTaXplID0gTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZO1xuICAgICAgICB9IGVsc2UgaWYgKGNhblNlbmRNTVMgPT09IDAgfHwgcmVtb3RlTU1TID09PSAwKSB7XG4gICAgICAgICAgbWF4TWVzc2FnZVNpemUgPSBNYXRoLm1heChjYW5TZW5kTU1TLCByZW1vdGVNTVMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1heE1lc3NhZ2VTaXplID0gTWF0aC5taW4oY2FuU2VuZE1NUywgcmVtb3RlTU1TKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBhIGR1bW15IFJUQ1NjdHBUcmFuc3BvcnQgb2JqZWN0IGFuZCB0aGUgJ21heE1lc3NhZ2VTaXplJ1xuICAgICAgICAvLyBhdHRyaWJ1dGUuXG4gICAgICAgIHZhciBzY3RwID0ge307XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShzY3RwLCAnbWF4TWVzc2FnZVNpemUnLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBtYXhNZXNzYWdlU2l6ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBwYy5fc2N0cCA9IHNjdHA7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBvcmlnU2V0UmVtb3RlRGVzY3JpcHRpb24uYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltU2VuZFRocm93VHlwZUVycm9yOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoISh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgJ2NyZWF0ZURhdGFDaGFubmVsJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE5vdGU6IEFsdGhvdWdoIEZpcmVmb3ggPj0gNTcgaGFzIGEgbmF0aXZlIGltcGxlbWVudGF0aW9uLCB0aGUgbWF4aW11bVxuICAgIC8vICAgICAgIG1lc3NhZ2Ugc2l6ZSBjYW4gYmUgcmVzZXQgZm9yIGFsbCBkYXRhIGNoYW5uZWxzIGF0IGEgbGF0ZXIgc3RhZ2UuXG4gICAgLy8gICAgICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNDI2ODMxXG5cbiAgICBmdW5jdGlvbiB3cmFwRGNTZW5kKGRjLCBwYykge1xuICAgICAgdmFyIG9yaWdEYXRhQ2hhbm5lbFNlbmQgPSBkYy5zZW5kO1xuICAgICAgZGMuc2VuZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgZGF0YSA9IGFyZ3VtZW50c1swXTtcbiAgICAgICAgdmFyIGxlbmd0aCA9IGRhdGEubGVuZ3RoIHx8IGRhdGEuc2l6ZSB8fCBkYXRhLmJ5dGVMZW5ndGg7XG4gICAgICAgIGlmIChkYy5yZWFkeVN0YXRlID09PSAnb3BlbicgJiZcbiAgICAgICAgICAgIHBjLnNjdHAgJiYgbGVuZ3RoID4gcGMuc2N0cC5tYXhNZXNzYWdlU2l6ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ01lc3NhZ2UgdG9vIGxhcmdlIChjYW4gc2VuZCBhIG1heGltdW0gb2YgJyArXG4gICAgICAgICAgICBwYy5zY3RwLm1heE1lc3NhZ2VTaXplICsgJyBieXRlcyknKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3JpZ0RhdGFDaGFubmVsU2VuZC5hcHBseShkYywgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfVxuICAgIHZhciBvcmlnQ3JlYXRlRGF0YUNoYW5uZWwgPVxuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVEYXRhQ2hhbm5lbDtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZURhdGFDaGFubmVsID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdmFyIGRhdGFDaGFubmVsID0gb3JpZ0NyZWF0ZURhdGFDaGFubmVsLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgICAgd3JhcERjU2VuZChkYXRhQ2hhbm5lbCwgcGMpO1xuICAgICAgcmV0dXJuIGRhdGFDaGFubmVsO1xuICAgIH07XG4gICAgdXRpbHMud3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCAnZGF0YWNoYW5uZWwnLCBmdW5jdGlvbihlKSB7XG4gICAgICB3cmFwRGNTZW5kKGUuY2hhbm5lbCwgZS50YXJnZXQpO1xuICAgICAgcmV0dXJuIGU7XG4gICAgfSk7XG4gIH1cbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKTtcbnZhciBmaWx0ZXJJY2VTZXJ2ZXJzID0gcmVxdWlyZSgnLi9maWx0ZXJpY2VzZXJ2ZXJzJyk7XG52YXIgc2hpbVJUQ1BlZXJDb25uZWN0aW9uID0gcmVxdWlyZSgncnRjcGVlcmNvbm5lY3Rpb24tc2hpbScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc2hpbUdldFVzZXJNZWRpYTogcmVxdWlyZSgnLi9nZXR1c2VybWVkaWEnKSxcbiAgc2hpbVBlZXJDb25uZWN0aW9uOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG5cbiAgICBpZiAod2luZG93LlJUQ0ljZUdhdGhlcmVyKSB7XG4gICAgICBpZiAoIXdpbmRvdy5SVENJY2VDYW5kaWRhdGUpIHtcbiAgICAgICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGFyZ3MpIHtcbiAgICAgICAgICByZXR1cm4gYXJncztcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmICghd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbikge1xuICAgICAgICB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uID0gZnVuY3Rpb24oYXJncykge1xuICAgICAgICAgIHJldHVybiBhcmdzO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgLy8gdGhpcyBhZGRzIGFuIGFkZGl0aW9uYWwgZXZlbnQgbGlzdGVuZXIgdG8gTWVkaWFTdHJhY2tUcmFjayB0aGF0IHNpZ25hbHNcbiAgICAgIC8vIHdoZW4gYSB0cmFja3MgZW5hYmxlZCBwcm9wZXJ0eSB3YXMgY2hhbmdlZC4gV29ya2Fyb3VuZCBmb3IgYSBidWcgaW5cbiAgICAgIC8vIGFkZFN0cmVhbSwgc2VlIGJlbG93LiBObyBsb25nZXIgcmVxdWlyZWQgaW4gMTUwMjUrXG4gICAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDE1MDI1KSB7XG4gICAgICAgIHZhciBvcmlnTVNURW5hYmxlZCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoXG4gICAgICAgICAgICB3aW5kb3cuTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUsICdlbmFibGVkJyk7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUsICdlbmFibGVkJywge1xuICAgICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIG9yaWdNU1RFbmFibGVkLnNldC5jYWxsKHRoaXMsIHZhbHVlKTtcbiAgICAgICAgICAgIHZhciBldiA9IG5ldyBFdmVudCgnZW5hYmxlZCcpO1xuICAgICAgICAgICAgZXYuZW5hYmxlZCA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KGV2KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9SVEMgZGVmaW5lcyB0aGUgRFRNRiBzZW5kZXIgYSBiaXQgZGlmZmVyZW50LlxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS93M2Mvb3J0Yy9pc3N1ZXMvNzE0XG4gICAgaWYgKHdpbmRvdy5SVENSdHBTZW5kZXIgJiYgISgnZHRtZicgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUsICdkdG1mJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICh0aGlzLl9kdG1mID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IG5ldyB3aW5kb3cuUlRDRHRtZlNlbmRlcih0aGlzKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy50cmFjay5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fZHRtZjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIEVkZ2UgY3VycmVudGx5IG9ubHkgaW1wbGVtZW50cyB0aGUgUlRDRHRtZlNlbmRlciwgbm90IHRoZVxuICAgIC8vIFJUQ0RUTUZTZW5kZXIgYWxpYXMuIFNlZSBodHRwOi8vZHJhZnQub3J0Yy5vcmcvI3J0Y2R0bWZzZW5kZXIyKlxuICAgIGlmICh3aW5kb3cuUlRDRHRtZlNlbmRlciAmJiAhd2luZG93LlJUQ0RUTUZTZW5kZXIpIHtcbiAgICAgIHdpbmRvdy5SVENEVE1GU2VuZGVyID0gd2luZG93LlJUQ0R0bWZTZW5kZXI7XG4gICAgfVxuXG4gICAgdmFyIFJUQ1BlZXJDb25uZWN0aW9uU2hpbSA9IHNoaW1SVENQZWVyQ29ubmVjdGlvbih3aW5kb3csXG4gICAgICAgIGJyb3dzZXJEZXRhaWxzLnZlcnNpb24pO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcuaWNlU2VydmVycykge1xuICAgICAgICBjb25maWcuaWNlU2VydmVycyA9IGZpbHRlckljZVNlcnZlcnMoY29uZmlnLmljZVNlcnZlcnMpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBSVENQZWVyQ29ubmVjdGlvblNoaW0oY29uZmlnKTtcbiAgICB9O1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgPSBSVENQZWVyQ29ubmVjdGlvblNoaW0ucHJvdG90eXBlO1xuICB9LFxuICBzaGltUmVwbGFjZVRyYWNrOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBPUlRDIGhhcyByZXBsYWNlVHJhY2sgLS0gaHR0cHM6Ly9naXRodWIuY29tL3czYy9vcnRjL2lzc3Vlcy82MTRcbiAgICBpZiAod2luZG93LlJUQ1J0cFNlbmRlciAmJlxuICAgICAgICAhKCdyZXBsYWNlVHJhY2snIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlKSkge1xuICAgICAgd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUucmVwbGFjZVRyYWNrID1cbiAgICAgICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZS5zZXRUcmFjaztcbiAgICB9XG4gIH1cbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxOCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKTtcbi8vIEVkZ2UgZG9lcyBub3QgbGlrZVxuLy8gMSkgc3R1bjogZmlsdGVyZWQgYWZ0ZXIgMTQzOTMgdW5sZXNzID90cmFuc3BvcnQ9dWRwIGlzIHByZXNlbnRcbi8vIDIpIHR1cm46IHRoYXQgZG9lcyBub3QgaGF2ZSBhbGwgb2YgdHVybjpob3N0OnBvcnQ/dHJhbnNwb3J0PXVkcFxuLy8gMykgdHVybjogd2l0aCBpcHY2IGFkZHJlc3Nlc1xuLy8gNCkgdHVybjogb2NjdXJyaW5nIG11bGlwbGUgdGltZXNcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oaWNlU2VydmVycywgZWRnZVZlcnNpb24pIHtcbiAgdmFyIGhhc1R1cm4gPSBmYWxzZTtcbiAgaWNlU2VydmVycyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoaWNlU2VydmVycykpO1xuICByZXR1cm4gaWNlU2VydmVycy5maWx0ZXIoZnVuY3Rpb24oc2VydmVyKSB7XG4gICAgaWYgKHNlcnZlciAmJiAoc2VydmVyLnVybHMgfHwgc2VydmVyLnVybCkpIHtcbiAgICAgIHZhciB1cmxzID0gc2VydmVyLnVybHMgfHwgc2VydmVyLnVybDtcbiAgICAgIGlmIChzZXJ2ZXIudXJsICYmICFzZXJ2ZXIudXJscykge1xuICAgICAgICB1dGlscy5kZXByZWNhdGVkKCdSVENJY2VTZXJ2ZXIudXJsJywgJ1JUQ0ljZVNlcnZlci51cmxzJyk7XG4gICAgICB9XG4gICAgICB2YXIgaXNTdHJpbmcgPSB0eXBlb2YgdXJscyA9PT0gJ3N0cmluZyc7XG4gICAgICBpZiAoaXNTdHJpbmcpIHtcbiAgICAgICAgdXJscyA9IFt1cmxzXTtcbiAgICAgIH1cbiAgICAgIHVybHMgPSB1cmxzLmZpbHRlcihmdW5jdGlvbih1cmwpIHtcbiAgICAgICAgdmFyIHZhbGlkVHVybiA9IHVybC5pbmRleE9mKCd0dXJuOicpID09PSAwICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZigndHJhbnNwb3J0PXVkcCcpICE9PSAtMSAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJ3R1cm46WycpID09PSAtMSAmJlxuICAgICAgICAgICAgIWhhc1R1cm47XG5cbiAgICAgICAgaWYgKHZhbGlkVHVybikge1xuICAgICAgICAgIGhhc1R1cm4gPSB0cnVlO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1cmwuaW5kZXhPZignc3R1bjonKSA9PT0gMCAmJiBlZGdlVmVyc2lvbiA+PSAxNDM5MyAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJz90cmFuc3BvcnQ9dWRwJykgPT09IC0xO1xuICAgICAgfSk7XG5cbiAgICAgIGRlbGV0ZSBzZXJ2ZXIudXJsO1xuICAgICAgc2VydmVyLnVybHMgPSBpc1N0cmluZyA/IHVybHNbMF0gOiB1cmxzO1xuICAgICAgcmV0dXJuICEhdXJscy5sZW5ndGg7XG4gICAgfVxuICB9KTtcbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih3aW5kb3cpIHtcbiAgdmFyIG5hdmlnYXRvciA9IHdpbmRvdyAmJiB3aW5kb3cubmF2aWdhdG9yO1xuXG4gIHZhciBzaGltRXJyb3JfID0gZnVuY3Rpb24oZSkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB7UGVybWlzc2lvbkRlbmllZEVycm9yOiAnTm90QWxsb3dlZEVycm9yJ31bZS5uYW1lXSB8fCBlLm5hbWUsXG4gICAgICBtZXNzYWdlOiBlLm1lc3NhZ2UsXG4gICAgICBjb25zdHJhaW50OiBlLmNvbnN0cmFpbnQsXG4gICAgICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm5hbWU7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICAvLyBnZXRVc2VyTWVkaWEgZXJyb3Igc2hpbS5cbiAgdmFyIG9yaWdHZXRVc2VyTWVkaWEgPSBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYS5cbiAgICAgIGJpbmQobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyk7XG4gIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oYykge1xuICAgIHJldHVybiBvcmlnR2V0VXNlck1lZGlhKGMpLmNhdGNoKGZ1bmN0aW9uKGUpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChzaGltRXJyb3JfKGUpKTtcbiAgICB9KTtcbiAgfTtcbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNoaW1HZXRVc2VyTWVkaWE6IHJlcXVpcmUoJy4vZ2V0dXNlcm1lZGlhJyksXG4gIHNoaW1PblRyYWNrOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmICEoJ29udHJhY2snIGluXG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ29udHJhY2snLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX29udHJhY2s7XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24oZikge1xuICAgICAgICAgIGlmICh0aGlzLl9vbnRyYWNrKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb250cmFjayk7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2FkZHN0cmVhbScsIHRoaXMuX29udHJhY2twb2x5KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29udHJhY2sgPSBmKTtcbiAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoJ2FkZHN0cmVhbScsIHRoaXMuX29udHJhY2twb2x5ID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgZS5zdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ3RyYWNrJyk7XG4gICAgICAgICAgICAgIGV2ZW50LnRyYWNrID0gdHJhY2s7XG4gICAgICAgICAgICAgIGV2ZW50LnJlY2VpdmVyID0ge3RyYWNrOiB0cmFja307XG4gICAgICAgICAgICAgIGV2ZW50LnRyYW5zY2VpdmVyID0ge3JlY2VpdmVyOiBldmVudC5yZWNlaXZlcn07XG4gICAgICAgICAgICAgIGV2ZW50LnN0cmVhbXMgPSBbZS5zdHJlYW1dO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENUcmFja0V2ZW50ICYmXG4gICAgICAgICgncmVjZWl2ZXInIGluIHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSkgJiZcbiAgICAgICAgISgndHJhbnNjZWl2ZXInIGluIHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUsICd0cmFuc2NlaXZlcicsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4ge3JlY2VpdmVyOiB0aGlzLnJlY2VpdmVyfTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNoaW1Tb3VyY2VPYmplY3Q6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIEZpcmVmb3ggaGFzIHN1cHBvcnRlZCBtb3pTcmNPYmplY3Qgc2luY2UgRkYyMiwgdW5wcmVmaXhlZCBpbiA0Mi5cbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh3aW5kb3cuSFRNTE1lZGlhRWxlbWVudCAmJlxuICAgICAgICAhKCdzcmNPYmplY3QnIGluIHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSkpIHtcbiAgICAgICAgLy8gU2hpbSB0aGUgc3JjT2JqZWN0IHByb3BlcnR5LCBvbmNlLCB3aGVuIEhUTUxNZWRpYUVsZW1lbnQgaXMgZm91bmQuXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUsICdzcmNPYmplY3QnLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm1velNyY09iamVjdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNldDogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICB0aGlzLm1velNyY09iamVjdCA9IHN0cmVhbTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBzaGltUGVlckNvbm5lY3Rpb246IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcblxuICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAnb2JqZWN0JyB8fCAhKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiB8fFxuICAgICAgICB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24pKSB7XG4gICAgICByZXR1cm47IC8vIHByb2JhYmx5IG1lZGlhLnBlZXJjb25uZWN0aW9uLmVuYWJsZWQ9ZmFsc2UgaW4gYWJvdXQ6Y29uZmlnXG4gICAgfVxuICAgIC8vIFRoZSBSVENQZWVyQ29ubmVjdGlvbiBvYmplY3QuXG4gICAgaWYgKCF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKSB7XG4gICAgICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgMzgpIHtcbiAgICAgICAgICAvLyAudXJscyBpcyBub3Qgc3VwcG9ydGVkIGluIEZGIDwgMzguXG4gICAgICAgICAgLy8gY3JlYXRlIFJUQ0ljZVNlcnZlcnMgd2l0aCBhIHNpbmdsZSB1cmwuXG4gICAgICAgICAgaWYgKHBjQ29uZmlnICYmIHBjQ29uZmlnLmljZVNlcnZlcnMpIHtcbiAgICAgICAgICAgIHZhciBuZXdJY2VTZXJ2ZXJzID0gW107XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBjQ29uZmlnLmljZVNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgdmFyIHNlcnZlciA9IHBjQ29uZmlnLmljZVNlcnZlcnNbaV07XG4gICAgICAgICAgICAgIGlmIChzZXJ2ZXIuaGFzT3duUHJvcGVydHkoJ3VybHMnKSkge1xuICAgICAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc2VydmVyLnVybHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICAgIHZhciBuZXdTZXJ2ZXIgPSB7XG4gICAgICAgICAgICAgICAgICAgIHVybDogc2VydmVyLnVybHNbal1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICBpZiAoc2VydmVyLnVybHNbal0uaW5kZXhPZigndHVybicpID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIG5ld1NlcnZlci51c2VybmFtZSA9IHNlcnZlci51c2VybmFtZTtcbiAgICAgICAgICAgICAgICAgICAgbmV3U2VydmVyLmNyZWRlbnRpYWwgPSBzZXJ2ZXIuY3JlZGVudGlhbDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChuZXdTZXJ2ZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2gocGNDb25maWcuaWNlU2VydmVyc1tpXSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBjQ29uZmlnLmljZVNlcnZlcnMgPSBuZXdJY2VTZXJ2ZXJzO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IHdpbmRvdy5tb3pSVENQZWVyQ29ubmVjdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cyk7XG4gICAgICB9O1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSA9XG4gICAgICAgICAgd2luZG93Lm1velJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcblxuICAgICAgLy8gd3JhcCBzdGF0aWMgbWV0aG9kcy4gQ3VycmVudGx5IGp1c3QgZ2VuZXJhdGVDZXJ0aWZpY2F0ZS5cbiAgICAgIGlmICh3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLCAnZ2VuZXJhdGVDZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHdpbmRvdy5tb3pSVENQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24gPSB3aW5kb3cubW96UlRDU2Vzc2lvbkRlc2NyaXB0aW9uO1xuICAgICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSA9IHdpbmRvdy5tb3pSVENJY2VDYW5kaWRhdGU7XG4gICAgfVxuXG4gICAgLy8gc2hpbSBhd2F5IG5lZWQgZm9yIG9ic29sZXRlIFJUQ0ljZUNhbmRpZGF0ZS9SVENTZXNzaW9uRGVzY3JpcHRpb24uXG4gICAgWydzZXRMb2NhbERlc2NyaXB0aW9uJywgJ3NldFJlbW90ZURlc2NyaXB0aW9uJywgJ2FkZEljZUNhbmRpZGF0ZSddXG4gICAgICAgIC5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICAgIHZhciBuYXRpdmVNZXRob2QgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBhcmd1bWVudHNbMF0gPSBuZXcgKChtZXRob2QgPT09ICdhZGRJY2VDYW5kaWRhdGUnKSA/XG4gICAgICAgICAgICAgICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSA6XG4gICAgICAgICAgICAgICAgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbikoYXJndW1lbnRzWzBdKTtcbiAgICAgICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcblxuICAgIC8vIHN1cHBvcnQgZm9yIGFkZEljZUNhbmRpZGF0ZShudWxsIG9yIHVuZGVmaW5lZClcbiAgICB2YXIgbmF0aXZlQWRkSWNlQ2FuZGlkYXRlID1cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGU7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGUgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghYXJndW1lbnRzWzBdKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHNbMV0pIHtcbiAgICAgICAgICBhcmd1bWVudHNbMV0uYXBwbHkobnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZUFkZEljZUNhbmRpZGF0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG5cbiAgICAvLyBzaGltIGdldFN0YXRzIHdpdGggbWFwbGlrZSBzdXBwb3J0XG4gICAgdmFyIG1ha2VNYXBTdGF0cyA9IGZ1bmN0aW9uKHN0YXRzKSB7XG4gICAgICB2YXIgbWFwID0gbmV3IE1hcCgpO1xuICAgICAgT2JqZWN0LmtleXMoc3RhdHMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgIG1hcC5zZXQoa2V5LCBzdGF0c1trZXldKTtcbiAgICAgICAgbWFwW2tleV0gPSBzdGF0c1trZXldO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbWFwO1xuICAgIH07XG5cbiAgICB2YXIgbW9kZXJuU3RhdHNUeXBlcyA9IHtcbiAgICAgIGluYm91bmRydHA6ICdpbmJvdW5kLXJ0cCcsXG4gICAgICBvdXRib3VuZHJ0cDogJ291dGJvdW5kLXJ0cCcsXG4gICAgICBjYW5kaWRhdGVwYWlyOiAnY2FuZGlkYXRlLXBhaXInLFxuICAgICAgbG9jYWxjYW5kaWRhdGU6ICdsb2NhbC1jYW5kaWRhdGUnLFxuICAgICAgcmVtb3RlY2FuZGlkYXRlOiAncmVtb3RlLWNhbmRpZGF0ZSdcbiAgICB9O1xuXG4gICAgdmFyIG5hdGl2ZUdldFN0YXRzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oXG4gICAgICBzZWxlY3RvcixcbiAgICAgIG9uU3VjYyxcbiAgICAgIG9uRXJyXG4gICAgKSB7XG4gICAgICByZXR1cm4gbmF0aXZlR2V0U3RhdHMuYXBwbHkodGhpcywgW3NlbGVjdG9yIHx8IG51bGxdKVxuICAgICAgICAudGhlbihmdW5jdGlvbihzdGF0cykge1xuICAgICAgICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNDgpIHtcbiAgICAgICAgICAgIHN0YXRzID0gbWFrZU1hcFN0YXRzKHN0YXRzKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA1MyAmJiAhb25TdWNjKSB7XG4gICAgICAgICAgICAvLyBTaGltIG9ubHkgcHJvbWlzZSBnZXRTdGF0cyB3aXRoIHNwZWMtaHlwaGVucyBpbiB0eXBlIG5hbWVzXG4gICAgICAgICAgICAvLyBMZWF2ZSBjYWxsYmFjayB2ZXJzaW9uIGFsb25lOyBtaXNjIG9sZCB1c2VzIG9mIGZvckVhY2ggYmVmb3JlIE1hcFxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihzdGF0KSB7XG4gICAgICAgICAgICAgICAgc3RhdC50eXBlID0gbW9kZXJuU3RhdHNUeXBlc1tzdGF0LnR5cGVdIHx8IHN0YXQudHlwZTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgIGlmIChlLm5hbWUgIT09ICdUeXBlRXJyb3InKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBBdm9pZCBUeXBlRXJyb3I6IFwidHlwZVwiIGlzIHJlYWQtb25seSwgaW4gb2xkIHZlcnNpb25zLiAzNC00M2lzaFxuICAgICAgICAgICAgICBzdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHN0YXQsIGkpIHtcbiAgICAgICAgICAgICAgICBzdGF0cy5zZXQoaSwgT2JqZWN0LmFzc2lnbih7fSwgc3RhdCwge1xuICAgICAgICAgICAgICAgICAgdHlwZTogbW9kZXJuU3RhdHNUeXBlc1tzdGF0LnR5cGVdIHx8IHN0YXQudHlwZVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBzdGF0cztcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4ob25TdWNjLCBvbkVycik7XG4gICAgfTtcbiAgfSxcblxuICBzaGltU2VuZGVyR2V0U3RhdHM6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAod2luZG93LlJUQ1J0cFNlbmRlciAmJiAnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBvcmlnR2V0U2VuZGVycyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycztcbiAgICBpZiAob3JpZ0dldFNlbmRlcnMpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICB2YXIgc2VuZGVycyA9IG9yaWdHZXRTZW5kZXJzLmFwcGx5KHBjLCBbXSk7XG4gICAgICAgIHNlbmRlcnMuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgICBzZW5kZXIuX3BjID0gcGM7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gc2VuZGVycztcbiAgICAgIH07XG4gICAgfVxuXG4gICAgdmFyIG9yaWdBZGRUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2s7XG4gICAgaWYgKG9yaWdBZGRUcmFjaykge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgc2VuZGVyID0gb3JpZ0FkZFRyYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIHNlbmRlci5fcGMgPSB0aGlzO1xuICAgICAgICByZXR1cm4gc2VuZGVyO1xuICAgICAgfTtcbiAgICB9XG4gICAgd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLnRyYWNrID8gdGhpcy5fcGMuZ2V0U3RhdHModGhpcy50cmFjaykgOlxuICAgICAgICAgIFByb21pc2UucmVzb2x2ZShuZXcgTWFwKCkpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVJlY2VpdmVyR2V0U3RhdHM6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAod2luZG93LlJUQ1J0cFNlbmRlciAmJiAnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBSZWNlaXZlci5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIG9yaWdHZXRSZWNlaXZlcnMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycztcbiAgICBpZiAob3JpZ0dldFJlY2VpdmVycykge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgdmFyIHJlY2VpdmVycyA9IG9yaWdHZXRSZWNlaXZlcnMuYXBwbHkocGMsIFtdKTtcbiAgICAgICAgcmVjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24ocmVjZWl2ZXIpIHtcbiAgICAgICAgICByZWNlaXZlci5fcGMgPSBwYztcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZWNlaXZlcnM7XG4gICAgICB9O1xuICAgIH1cbiAgICB1dGlscy53cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csICd0cmFjaycsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIGUucmVjZWl2ZXIuX3BjID0gZS5zcmNFbGVtZW50O1xuICAgICAgcmV0dXJuIGU7XG4gICAgfSk7XG4gICAgd2luZG93LlJUQ1J0cFJlY2VpdmVyLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuX3BjLmdldFN0YXRzKHRoaXMudHJhY2spO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVJlbW92ZVN0cmVhbTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKCF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gfHxcbiAgICAgICAgJ3JlbW92ZVN0cmVhbScgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ3JlbW92ZVN0cmVhbScsICdyZW1vdmVUcmFjaycpO1xuICAgICAgdGhpcy5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgaWYgKHNlbmRlci50cmFjayAmJiBzdHJlYW0uZ2V0VHJhY2tzKCkuaW5kZXhPZihzZW5kZXIudHJhY2spICE9PSAtMSkge1xuICAgICAgICAgIHBjLnJlbW92ZVRyYWNrKHNlbmRlcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVJUQ0RhdGFDaGFubmVsOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyByZW5hbWUgRGF0YUNoYW5uZWwgdG8gUlRDRGF0YUNoYW5uZWwgKG5hdGl2ZSBmaXggaW4gRkY2MCk6XG4gICAgLy8gaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTE3Mzg1MVxuICAgIGlmICh3aW5kb3cuRGF0YUNoYW5uZWwgJiYgIXdpbmRvdy5SVENEYXRhQ2hhbm5lbCkge1xuICAgICAgd2luZG93LlJUQ0RhdGFDaGFubmVsID0gd2luZG93LkRhdGFDaGFubmVsO1xuICAgIH1cbiAgfSxcbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKTtcbnZhciBsb2dnaW5nID0gdXRpbHMubG9nO1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHdpbmRvdykge1xuICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG4gIHZhciBuYXZpZ2F0b3IgPSB3aW5kb3cgJiYgd2luZG93Lm5hdmlnYXRvcjtcbiAgdmFyIE1lZGlhU3RyZWFtVHJhY2sgPSB3aW5kb3cgJiYgd2luZG93Lk1lZGlhU3RyZWFtVHJhY2s7XG5cbiAgdmFyIHNoaW1FcnJvcl8gPSBmdW5jdGlvbihlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHtcbiAgICAgICAgSW50ZXJuYWxFcnJvcjogJ05vdFJlYWRhYmxlRXJyb3InLFxuICAgICAgICBOb3RTdXBwb3J0ZWRFcnJvcjogJ1R5cGVFcnJvcicsXG4gICAgICAgIFBlcm1pc3Npb25EZW5pZWRFcnJvcjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIFNlY3VyaXR5RXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InXG4gICAgICB9W2UubmFtZV0gfHwgZS5uYW1lLFxuICAgICAgbWVzc2FnZToge1xuICAgICAgICAnVGhlIG9wZXJhdGlvbiBpcyBpbnNlY3VyZS4nOiAnVGhlIHJlcXVlc3QgaXMgbm90IGFsbG93ZWQgYnkgdGhlICcgK1xuICAgICAgICAndXNlciBhZ2VudCBvciB0aGUgcGxhdGZvcm0gaW4gdGhlIGN1cnJlbnQgY29udGV4dC4nXG4gICAgICB9W2UubWVzc2FnZV0gfHwgZS5tZXNzYWdlLFxuICAgICAgY29uc3RyYWludDogZS5jb25zdHJhaW50LFxuICAgICAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5uYW1lICsgKHRoaXMubWVzc2FnZSAmJiAnOiAnKSArIHRoaXMubWVzc2FnZTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIC8vIGdldFVzZXJNZWRpYSBjb25zdHJhaW50cyBzaGltLlxuICB2YXIgZ2V0VXNlck1lZGlhXyA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzLCBvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgICB2YXIgY29uc3RyYWludHNUb0ZGMzdfID0gZnVuY3Rpb24oYykge1xuICAgICAgaWYgKHR5cGVvZiBjICE9PSAnb2JqZWN0JyB8fCBjLnJlcXVpcmUpIHtcbiAgICAgICAgcmV0dXJuIGM7XG4gICAgICB9XG4gICAgICB2YXIgcmVxdWlyZSA9IFtdO1xuICAgICAgT2JqZWN0LmtleXMoYykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgaWYgKGtleSA9PT0gJ3JlcXVpcmUnIHx8IGtleSA9PT0gJ2FkdmFuY2VkJyB8fCBrZXkgPT09ICdtZWRpYVNvdXJjZScpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHIgPSBjW2tleV0gPSAodHlwZW9mIGNba2V5XSA9PT0gJ29iamVjdCcpID9cbiAgICAgICAgICAgIGNba2V5XSA6IHtpZGVhbDogY1trZXldfTtcbiAgICAgICAgaWYgKHIubWluICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICAgIHIubWF4ICE9PSB1bmRlZmluZWQgfHwgci5leGFjdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcmVxdWlyZS5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHIuZXhhY3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmICh0eXBlb2Ygci5leGFjdCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIHIuIG1pbiA9IHIubWF4ID0gci5leGFjdDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY1trZXldID0gci5leGFjdDtcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVsZXRlIHIuZXhhY3Q7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHIuaWRlYWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGMuYWR2YW5jZWQgPSBjLmFkdmFuY2VkIHx8IFtdO1xuICAgICAgICAgIHZhciBvYyA9IHt9O1xuICAgICAgICAgIGlmICh0eXBlb2Ygci5pZGVhbCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG9jW2tleV0gPSB7bWluOiByLmlkZWFsLCBtYXg6IHIuaWRlYWx9O1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvY1trZXldID0gci5pZGVhbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgYy5hZHZhbmNlZC5wdXNoKG9jKTtcbiAgICAgICAgICBkZWxldGUgci5pZGVhbDtcbiAgICAgICAgICBpZiAoIU9iamVjdC5rZXlzKHIpLmxlbmd0aCkge1xuICAgICAgICAgICAgZGVsZXRlIGNba2V5XTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKHJlcXVpcmUubGVuZ3RoKSB7XG4gICAgICAgIGMucmVxdWlyZSA9IHJlcXVpcmU7XG4gICAgICB9XG4gICAgICByZXR1cm4gYztcbiAgICB9O1xuICAgIGNvbnN0cmFpbnRzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgMzgpIHtcbiAgICAgIGxvZ2dpbmcoJ3NwZWM6ICcgKyBKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgICAgaWYgKGNvbnN0cmFpbnRzLmF1ZGlvKSB7XG4gICAgICAgIGNvbnN0cmFpbnRzLmF1ZGlvID0gY29uc3RyYWludHNUb0ZGMzdfKGNvbnN0cmFpbnRzLmF1ZGlvKTtcbiAgICAgIH1cbiAgICAgIGlmIChjb25zdHJhaW50cy52aWRlbykge1xuICAgICAgICBjb25zdHJhaW50cy52aWRlbyA9IGNvbnN0cmFpbnRzVG9GRjM3Xyhjb25zdHJhaW50cy52aWRlbyk7XG4gICAgICB9XG4gICAgICBsb2dnaW5nKCdmZjM3OiAnICsgSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5hdmlnYXRvci5tb3pHZXRVc2VyTWVkaWEoY29uc3RyYWludHMsIG9uU3VjY2VzcywgZnVuY3Rpb24oZSkge1xuICAgICAgb25FcnJvcihzaGltRXJyb3JfKGUpKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIHRoZSByZXN1bHQgb2YgZ2V0VXNlck1lZGlhIGFzIGEgUHJvbWlzZS5cbiAgdmFyIGdldFVzZXJNZWRpYVByb21pc2VfID0gZnVuY3Rpb24oY29uc3RyYWludHMpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBnZXRVc2VyTWVkaWFfKGNvbnN0cmFpbnRzLCByZXNvbHZlLCByZWplY3QpO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIFNoaW0gZm9yIG1lZGlhRGV2aWNlcyBvbiBvbGRlciB2ZXJzaW9ucy5cbiAgaWYgKCFuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKSB7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcyA9IHtnZXRVc2VyTWVkaWE6IGdldFVzZXJNZWRpYVByb21pc2VfLFxuICAgICAgYWRkRXZlbnRMaXN0ZW5lcjogZnVuY3Rpb24oKSB7IH0sXG4gICAgICByZW1vdmVFdmVudExpc3RlbmVyOiBmdW5jdGlvbigpIHsgfVxuICAgIH07XG4gIH1cbiAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5lbnVtZXJhdGVEZXZpY2VzID1cbiAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcyB8fCBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICB2YXIgaW5mb3MgPSBbXG4gICAgICAgICAgICB7a2luZDogJ2F1ZGlvaW5wdXQnLCBkZXZpY2VJZDogJ2RlZmF1bHQnLCBsYWJlbDogJycsIGdyb3VwSWQ6ICcnfSxcbiAgICAgICAgICAgIHtraW5kOiAndmlkZW9pbnB1dCcsIGRldmljZUlkOiAnZGVmYXVsdCcsIGxhYmVsOiAnJywgZ3JvdXBJZDogJyd9XG4gICAgICAgICAgXTtcbiAgICAgICAgICByZXNvbHZlKGluZm9zKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNDEpIHtcbiAgICAvLyBXb3JrIGFyb3VuZCBodHRwOi8vYnVnemlsLmxhLzExNjk2NjVcbiAgICB2YXIgb3JnRW51bWVyYXRlRGV2aWNlcyA9XG4gICAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcy5iaW5kKG5hdmlnYXRvci5tZWRpYURldmljZXMpO1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIG9yZ0VudW1lcmF0ZURldmljZXMoKS50aGVuKHVuZGVmaW5lZCwgZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAoZS5uYW1lID09PSAnTm90Rm91bmRFcnJvcicpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbiAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA0OSkge1xuICAgIHZhciBvcmlnR2V0VXNlck1lZGlhID0gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEuXG4gICAgICAgIGJpbmQobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyk7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjKSB7XG4gICAgICByZXR1cm4gb3JpZ0dldFVzZXJNZWRpYShjKS50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAvLyBXb3JrIGFyb3VuZCBodHRwczovL2J1Z3ppbC5sYS84MDIzMjZcbiAgICAgICAgaWYgKGMuYXVkaW8gJiYgIXN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmxlbmd0aCB8fFxuICAgICAgICAgICAgYy52aWRlbyAmJiAhc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkubGVuZ3RoKSB7XG4gICAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdUaGUgb2JqZWN0IGNhbiBub3QgYmUgZm91bmQgaGVyZS4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ05vdEZvdW5kRXJyb3InKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc3RyZWFtO1xuICAgICAgfSwgZnVuY3Rpb24oZSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3Qoc2hpbUVycm9yXyhlKSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9XG4gIGlmICghKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPiA1NSAmJlxuICAgICAgJ2F1dG9HYWluQ29udHJvbCcgaW4gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRTdXBwb3J0ZWRDb25zdHJhaW50cygpKSkge1xuICAgIHZhciByZW1hcCA9IGZ1bmN0aW9uKG9iaiwgYSwgYikge1xuICAgICAgaWYgKGEgaW4gb2JqICYmICEoYiBpbiBvYmopKSB7XG4gICAgICAgIG9ialtiXSA9IG9ialthXTtcbiAgICAgICAgZGVsZXRlIG9ialthXTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIG5hdGl2ZUdldFVzZXJNZWRpYSA9IG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhLlxuICAgICAgICBiaW5kKG5hdmlnYXRvci5tZWRpYURldmljZXMpO1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oYykge1xuICAgICAgaWYgKHR5cGVvZiBjID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgYy5hdWRpbyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgYyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYykpO1xuICAgICAgICByZW1hcChjLmF1ZGlvLCAnYXV0b0dhaW5Db250cm9sJywgJ21vekF1dG9HYWluQ29udHJvbCcpO1xuICAgICAgICByZW1hcChjLmF1ZGlvLCAnbm9pc2VTdXBwcmVzc2lvbicsICdtb3pOb2lzZVN1cHByZXNzaW9uJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlR2V0VXNlck1lZGlhKGMpO1xuICAgIH07XG5cbiAgICBpZiAoTWVkaWFTdHJlYW1UcmFjayAmJiBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5nZXRTZXR0aW5ncykge1xuICAgICAgdmFyIG5hdGl2ZUdldFNldHRpbmdzID0gTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuZ2V0U2V0dGluZ3M7XG4gICAgICBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5nZXRTZXR0aW5ncyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgb2JqID0gbmF0aXZlR2V0U2V0dGluZ3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgcmVtYXAob2JqLCAnbW96QXV0b0dhaW5Db250cm9sJywgJ2F1dG9HYWluQ29udHJvbCcpO1xuICAgICAgICByZW1hcChvYmosICdtb3pOb2lzZVN1cHByZXNzaW9uJywgJ25vaXNlU3VwcHJlc3Npb24nKTtcbiAgICAgICAgcmV0dXJuIG9iajtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgaWYgKE1lZGlhU3RyZWFtVHJhY2sgJiYgTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuYXBwbHlDb25zdHJhaW50cykge1xuICAgICAgdmFyIG5hdGl2ZUFwcGx5Q29uc3RyYWludHMgPSBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5hcHBseUNvbnN0cmFpbnRzO1xuICAgICAgTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuYXBwbHlDb25zdHJhaW50cyA9IGZ1bmN0aW9uKGMpIHtcbiAgICAgICAgaWYgKHRoaXMua2luZCA9PT0gJ2F1ZGlvJyAmJiB0eXBlb2YgYyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBjID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjKSk7XG4gICAgICAgICAgcmVtYXAoYywgJ2F1dG9HYWluQ29udHJvbCcsICdtb3pBdXRvR2FpbkNvbnRyb2wnKTtcbiAgICAgICAgICByZW1hcChjLCAnbm9pc2VTdXBwcmVzc2lvbicsICdtb3pOb2lzZVN1cHByZXNzaW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5hdGl2ZUFwcGx5Q29uc3RyYWludHMuYXBwbHkodGhpcywgW2NdKTtcbiAgICAgIH07XG4gICAgfVxuICB9XG4gIG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkVycm9yKSB7XG4gICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA0NCkge1xuICAgICAgcmV0dXJuIGdldFVzZXJNZWRpYV8oY29uc3RyYWludHMsIG9uU3VjY2Vzcywgb25FcnJvcik7XG4gICAgfVxuICAgIC8vIFJlcGxhY2UgRmlyZWZveCA0NCsncyBkZXByZWNhdGlvbiB3YXJuaW5nIHdpdGggdW5wcmVmaXhlZCB2ZXJzaW9uLlxuICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ25hdmlnYXRvci5nZXRVc2VyTWVkaWEnLFxuICAgICAgICAnbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEnKTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cykudGhlbihvblN1Y2Nlc3MsIG9uRXJyb3IpO1xuICB9O1xufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNoaW1Mb2NhbFN0cmVhbXNBUEk6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAnb2JqZWN0JyB8fCAhd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghKCdnZXRMb2NhbFN0cmVhbXMnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldExvY2FsU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoIXRoaXMuX2xvY2FsU3RyZWFtcykge1xuICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9sb2NhbFN0cmVhbXM7XG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoISgnZ2V0U3RyZWFtQnlJZCcgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RyZWFtQnlJZCA9IGZ1bmN0aW9uKGlkKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBudWxsO1xuICAgICAgICBpZiAodGhpcy5fbG9jYWxTdHJlYW1zKSB7XG4gICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICBpZiAoc3RyZWFtLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICByZXN1bHQgPSBzdHJlYW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX3JlbW90ZVN0cmVhbXMpIHtcbiAgICAgICAgICB0aGlzLl9yZW1vdGVTdHJlYW1zLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICBpZiAoc3RyZWFtLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICByZXN1bHQgPSBzdHJlYW07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG4gICAgfVxuICAgIGlmICghKCdhZGRTdHJlYW0nIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICB2YXIgX2FkZFRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjaztcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIGlmICghdGhpcy5fbG9jYWxTdHJlYW1zKSB7XG4gICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zID0gW107XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2xvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPT09IC0xKSB7XG4gICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgIF9hZGRUcmFjay5jYWxsKHBjLCB0cmFjaywgc3RyZWFtKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24odHJhY2ssIHN0cmVhbSkge1xuICAgICAgICBpZiAoc3RyZWFtKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLl9sb2NhbFN0cmVhbXMpIHtcbiAgICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcyA9IFtzdHJlYW1dO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5fbG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBfYWRkVHJhY2suY2FsbCh0aGlzLCB0cmFjaywgc3RyZWFtKTtcbiAgICAgIH07XG4gICAgfVxuICAgIGlmICghKCdyZW1vdmVTdHJlYW0nIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICBpZiAoIXRoaXMuX2xvY2FsU3RyZWFtcykge1xuICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbmRleCA9IHRoaXMuX2xvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSk7XG4gICAgICAgIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHZhciB0cmFja3MgPSBzdHJlYW0uZ2V0VHJhY2tzKCk7XG4gICAgICAgIHRoaXMuZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgICAgaWYgKHRyYWNrcy5pbmRleE9mKHNlbmRlci50cmFjaykgIT09IC0xKSB7XG4gICAgICAgICAgICBwYy5yZW1vdmVUcmFjayhzZW5kZXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH1cbiAgfSxcbiAgc2hpbVJlbW90ZVN0cmVhbXNBUEk6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAnb2JqZWN0JyB8fCAhd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghKCdnZXRSZW1vdGVTdHJlYW1zJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZW1vdGVTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZW1vdGVTdHJlYW1zID8gdGhpcy5fcmVtb3RlU3RyZWFtcyA6IFtdO1xuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKCEoJ29uYWRkc3RyZWFtJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdvbmFkZHN0cmVhbScsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fb25hZGRzdHJlYW07XG4gICAgICAgIH0sXG4gICAgICAgIHNldDogZnVuY3Rpb24oZikge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgaWYgKHRoaXMuX29uYWRkc3RyZWFtKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2FkZHN0cmVhbScsIHRoaXMuX29uYWRkc3RyZWFtKTtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbmFkZHN0cmVhbXBvbHkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoJ2FkZHN0cmVhbScsIHRoaXMuX29uYWRkc3RyZWFtID0gZik7XG4gICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29uYWRkc3RyZWFtcG9seSA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIGUuc3RyZWFtcy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgICAgICBpZiAoIXBjLl9yZW1vdGVTdHJlYW1zKSB7XG4gICAgICAgICAgICAgICAgcGMuX3JlbW90ZVN0cmVhbXMgPSBbXTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAocGMuX3JlbW90ZVN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID49IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcGMuX3JlbW90ZVN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2FkZHN0cmVhbScpO1xuICAgICAgICAgICAgICBldmVudC5zdHJlYW0gPSBzdHJlYW07XG4gICAgICAgICAgICAgIHBjLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgc2hpbUNhbGxiYWNrc0FQSTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICdvYmplY3QnIHx8ICF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHByb3RvdHlwZSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG4gICAgdmFyIGNyZWF0ZU9mZmVyID0gcHJvdG90eXBlLmNyZWF0ZU9mZmVyO1xuICAgIHZhciBjcmVhdGVBbnN3ZXIgPSBwcm90b3R5cGUuY3JlYXRlQW5zd2VyO1xuICAgIHZhciBzZXRMb2NhbERlc2NyaXB0aW9uID0gcHJvdG90eXBlLnNldExvY2FsRGVzY3JpcHRpb247XG4gICAgdmFyIHNldFJlbW90ZURlc2NyaXB0aW9uID0gcHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uO1xuICAgIHZhciBhZGRJY2VDYW5kaWRhdGUgPSBwcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlO1xuXG4gICAgcHJvdG90eXBlLmNyZWF0ZU9mZmVyID0gZnVuY3Rpb24oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBvcHRpb25zID0gKGFyZ3VtZW50cy5sZW5ndGggPj0gMikgPyBhcmd1bWVudHNbMl0gOiBhcmd1bWVudHNbMF07XG4gICAgICB2YXIgcHJvbWlzZSA9IGNyZWF0ZU9mZmVyLmFwcGx5KHRoaXMsIFtvcHRpb25zXSk7XG4gICAgICBpZiAoIWZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgIH1cbiAgICAgIHByb21pc2UudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjayk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcblxuICAgIHByb3RvdHlwZS5jcmVhdGVBbnN3ZXIgPSBmdW5jdGlvbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgdmFyIG9wdGlvbnMgPSAoYXJndW1lbnRzLmxlbmd0aCA+PSAyKSA/IGFyZ3VtZW50c1syXSA6IGFyZ3VtZW50c1swXTtcbiAgICAgIHZhciBwcm9taXNlID0gY3JlYXRlQW5zd2VyLmFwcGx5KHRoaXMsIFtvcHRpb25zXSk7XG4gICAgICBpZiAoIWZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgIH1cbiAgICAgIHByb21pc2UudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjayk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcblxuICAgIHZhciB3aXRoQ2FsbGJhY2sgPSBmdW5jdGlvbihkZXNjcmlwdGlvbiwgc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwcm9taXNlID0gc2V0TG9jYWxEZXNjcmlwdGlvbi5hcHBseSh0aGlzLCBbZGVzY3JpcHRpb25dKTtcbiAgICAgIGlmICghZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9O1xuICAgIHByb3RvdHlwZS5zZXRMb2NhbERlc2NyaXB0aW9uID0gd2l0aENhbGxiYWNrO1xuXG4gICAgd2l0aENhbGxiYWNrID0gZnVuY3Rpb24oZGVzY3JpcHRpb24sIHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcHJvbWlzZSA9IHNldFJlbW90ZURlc2NyaXB0aW9uLmFwcGx5KHRoaXMsIFtkZXNjcmlwdGlvbl0pO1xuICAgICAgaWYgKCFmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9XG4gICAgICBwcm9taXNlLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH07XG4gICAgcHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uID0gd2l0aENhbGxiYWNrO1xuXG4gICAgd2l0aENhbGxiYWNrID0gZnVuY3Rpb24oY2FuZGlkYXRlLCBzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgdmFyIHByb21pc2UgPSBhZGRJY2VDYW5kaWRhdGUuYXBwbHkodGhpcywgW2NhbmRpZGF0ZV0pO1xuICAgICAgaWYgKCFmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9XG4gICAgICBwcm9taXNlLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH07XG4gICAgcHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZSA9IHdpdGhDYWxsYmFjaztcbiAgfSxcbiAgc2hpbUdldFVzZXJNZWRpYTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIG5hdmlnYXRvciA9IHdpbmRvdyAmJiB3aW5kb3cubmF2aWdhdG9yO1xuXG4gICAgaWYgKCFuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhKSB7XG4gICAgICBpZiAobmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYSkge1xuICAgICAgICBuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhID0gbmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYS5iaW5kKG5hdmlnYXRvcik7XG4gICAgICB9IGVsc2UgaWYgKG5hdmlnYXRvci5tZWRpYURldmljZXMgJiZcbiAgICAgICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSkge1xuICAgICAgICBuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oY29uc3RyYWludHMsIGNiLCBlcnJjYikge1xuICAgICAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzKVxuICAgICAgICAgIC50aGVuKGNiLCBlcnJjYik7XG4gICAgICAgIH0uYmluZChuYXZpZ2F0b3IpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgc2hpbVJUQ0ljZVNlcnZlclVybHM6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIG1pZ3JhdGUgZnJvbSBub24tc3BlYyBSVENJY2VTZXJ2ZXIudXJsIHRvIFJUQ0ljZVNlcnZlci51cmxzXG4gICAgdmFyIE9yaWdQZWVyQ29ubmVjdGlvbiA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbjtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cykge1xuICAgICAgaWYgKHBjQ29uZmlnICYmIHBjQ29uZmlnLmljZVNlcnZlcnMpIHtcbiAgICAgICAgdmFyIG5ld0ljZVNlcnZlcnMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwY0NvbmZpZy5pY2VTZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgdmFyIHNlcnZlciA9IHBjQ29uZmlnLmljZVNlcnZlcnNbaV07XG4gICAgICAgICAgaWYgKCFzZXJ2ZXIuaGFzT3duUHJvcGVydHkoJ3VybHMnKSAmJlxuICAgICAgICAgICAgICBzZXJ2ZXIuaGFzT3duUHJvcGVydHkoJ3VybCcpKSB7XG4gICAgICAgICAgICB1dGlscy5kZXByZWNhdGVkKCdSVENJY2VTZXJ2ZXIudXJsJywgJ1JUQ0ljZVNlcnZlci51cmxzJyk7XG4gICAgICAgICAgICBzZXJ2ZXIgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHNlcnZlcikpO1xuICAgICAgICAgICAgc2VydmVyLnVybHMgPSBzZXJ2ZXIudXJsO1xuICAgICAgICAgICAgZGVsZXRlIHNlcnZlci51cmw7XG4gICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2goc2VydmVyKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKHBjQ29uZmlnLmljZVNlcnZlcnNbaV0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwY0NvbmZpZy5pY2VTZXJ2ZXJzID0gbmV3SWNlU2VydmVycztcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgT3JpZ1BlZXJDb25uZWN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKTtcbiAgICB9O1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgPSBPcmlnUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuICAgIC8vIHdyYXAgc3RhdGljIG1ldGhvZHMuIEN1cnJlbnRseSBqdXN0IGdlbmVyYXRlQ2VydGlmaWNhdGUuXG4gICAgaWYgKCdnZW5lcmF0ZUNlcnRpZmljYXRlJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24sICdnZW5lcmF0ZUNlcnRpZmljYXRlJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBPcmlnUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBzaGltVHJhY2tFdmVudFRyYW5zY2VpdmVyOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBBZGQgZXZlbnQudHJhbnNjZWl2ZXIgbWVtYmVyIG92ZXIgZGVwcmVjYXRlZCBldmVudC5yZWNlaXZlclxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgKCdyZWNlaXZlcicgaW4gd2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlKSAmJlxuICAgICAgICAvLyBjYW4ndCBjaGVjayAndHJhbnNjZWl2ZXInIGluIHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSwgYXMgaXQgaXNcbiAgICAgICAgLy8gZGVmaW5lZCBmb3Igc29tZSByZWFzb24gZXZlbiB3aGVuIHdpbmRvdy5SVENUcmFuc2NlaXZlciBpcyBub3QuXG4gICAgICAgICF3aW5kb3cuUlRDVHJhbnNjZWl2ZXIpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUsICd0cmFuc2NlaXZlcicsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4ge3JlY2VpdmVyOiB0aGlzLnJlY2VpdmVyfTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNoaW1DcmVhdGVPZmZlckxlZ2FjeTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIG9yaWdDcmVhdGVPZmZlciA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlT2ZmZXI7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVPZmZlciA9IGZ1bmN0aW9uKG9mZmVyT3B0aW9ucykge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIGlmIChvZmZlck9wdGlvbnMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAvLyBzdXBwb3J0IGJpdCB2YWx1ZXNcbiAgICAgICAgICBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyA9ICEhb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW87XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGF1ZGlvVHJhbnNjZWl2ZXIgPSBwYy5nZXRUcmFuc2NlaXZlcnMoKS5maW5kKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgcmV0dXJuIHRyYW5zY2VpdmVyLnNlbmRlci50cmFjayAmJlxuICAgICAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kZXIudHJhY2sua2luZCA9PT0gJ2F1ZGlvJztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyA9PT0gZmFsc2UgJiYgYXVkaW9UcmFuc2NlaXZlcikge1xuICAgICAgICAgIGlmIChhdWRpb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2Jykge1xuICAgICAgICAgICAgaWYgKGF1ZGlvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKSB7XG4gICAgICAgICAgICAgIGF1ZGlvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKCdzZW5kb25seScpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXVkaW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPSAnc2VuZG9ubHknO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoYXVkaW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPT09ICdyZWN2b25seScpIHtcbiAgICAgICAgICAgIGlmIChhdWRpb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbikge1xuICAgICAgICAgICAgICBhdWRpb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbignaW5hY3RpdmUnKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGF1ZGlvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID0gJ2luYWN0aXZlJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPT09IHRydWUgJiZcbiAgICAgICAgICAgICFhdWRpb1RyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgcGMuYWRkVHJhbnNjZWl2ZXIoJ2F1ZGlvJyk7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmICh0eXBlb2Ygb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgLy8gc3VwcG9ydCBiaXQgdmFsdWVzXG4gICAgICAgICAgb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gPSAhIW9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2aWRlb1RyYW5zY2VpdmVyID0gcGMuZ2V0VHJhbnNjZWl2ZXJzKCkuZmluZChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgICAgIHJldHVybiB0cmFuc2NlaXZlci5zZW5kZXIudHJhY2sgJiZcbiAgICAgICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZGVyLnRyYWNrLmtpbmQgPT09ICd2aWRlbyc7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gPT09IGZhbHNlICYmIHZpZGVvVHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBpZiAodmlkZW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPT09ICdzZW5kcmVjdicpIHtcbiAgICAgICAgICAgIHZpZGVvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKCdzZW5kb25seScpO1xuICAgICAgICAgIH0gZWxzZSBpZiAodmlkZW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPT09ICdyZWN2b25seScpIHtcbiAgICAgICAgICAgIHZpZGVvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKCdpbmFjdGl2ZScpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyA9PT0gdHJ1ZSAmJlxuICAgICAgICAgICAgIXZpZGVvVHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBwYy5hZGRUcmFuc2NlaXZlcigndmlkZW8nKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIG9yaWdDcmVhdGVPZmZlci5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciBsb2dEaXNhYmxlZF8gPSB0cnVlO1xudmFyIGRlcHJlY2F0aW9uV2FybmluZ3NfID0gdHJ1ZTtcblxuLyoqXG4gKiBFeHRyYWN0IGJyb3dzZXIgdmVyc2lvbiBvdXQgb2YgdGhlIHByb3ZpZGVkIHVzZXIgYWdlbnQgc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7IXN0cmluZ30gdWFzdHJpbmcgdXNlckFnZW50IHN0cmluZy5cbiAqIEBwYXJhbSB7IXN0cmluZ30gZXhwciBSZWd1bGFyIGV4cHJlc3Npb24gdXNlZCBhcyBtYXRjaCBjcml0ZXJpYS5cbiAqIEBwYXJhbSB7IW51bWJlcn0gcG9zIHBvc2l0aW9uIGluIHRoZSB2ZXJzaW9uIHN0cmluZyB0byBiZSByZXR1cm5lZC5cbiAqIEByZXR1cm4geyFudW1iZXJ9IGJyb3dzZXIgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFZlcnNpb24odWFzdHJpbmcsIGV4cHIsIHBvcykge1xuICB2YXIgbWF0Y2ggPSB1YXN0cmluZy5tYXRjaChleHByKTtcbiAgcmV0dXJuIG1hdGNoICYmIG1hdGNoLmxlbmd0aCA+PSBwb3MgJiYgcGFyc2VJbnQobWF0Y2hbcG9zXSwgMTApO1xufVxuXG4vLyBXcmFwcyB0aGUgcGVlcmNvbm5lY3Rpb24gZXZlbnQgZXZlbnROYW1lVG9XcmFwIGluIGEgZnVuY3Rpb25cbi8vIHdoaWNoIHJldHVybnMgdGhlIG1vZGlmaWVkIGV2ZW50IG9iamVjdC5cbmZ1bmN0aW9uIHdyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgZXZlbnROYW1lVG9XcmFwLCB3cmFwcGVyKSB7XG4gIGlmICghd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBwcm90byA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG4gIHZhciBuYXRpdmVBZGRFdmVudExpc3RlbmVyID0gcHJvdG8uYWRkRXZlbnRMaXN0ZW5lcjtcbiAgcHJvdG8uYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKG5hdGl2ZUV2ZW50TmFtZSwgY2IpIHtcbiAgICBpZiAobmF0aXZlRXZlbnROYW1lICE9PSBldmVudE5hbWVUb1dyYXApIHtcbiAgICAgIHJldHVybiBuYXRpdmVBZGRFdmVudExpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIHZhciB3cmFwcGVkQ2FsbGJhY2sgPSBmdW5jdGlvbihlKSB7XG4gICAgICBjYih3cmFwcGVyKGUpKTtcbiAgICB9O1xuICAgIHRoaXMuX2V2ZW50TWFwID0gdGhpcy5fZXZlbnRNYXAgfHwge307XG4gICAgdGhpcy5fZXZlbnRNYXBbY2JdID0gd3JhcHBlZENhbGxiYWNrO1xuICAgIHJldHVybiBuYXRpdmVBZGRFdmVudExpc3RlbmVyLmFwcGx5KHRoaXMsIFtuYXRpdmVFdmVudE5hbWUsXG4gICAgICB3cmFwcGVkQ2FsbGJhY2tdKTtcbiAgfTtcblxuICB2YXIgbmF0aXZlUmVtb3ZlRXZlbnRMaXN0ZW5lciA9IHByb3RvLnJlbW92ZUV2ZW50TGlzdGVuZXI7XG4gIHByb3RvLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihuYXRpdmVFdmVudE5hbWUsIGNiKSB7XG4gICAgaWYgKG5hdGl2ZUV2ZW50TmFtZSAhPT0gZXZlbnROYW1lVG9XcmFwIHx8ICF0aGlzLl9ldmVudE1hcFxuICAgICAgICB8fCAhdGhpcy5fZXZlbnRNYXBbY2JdKSB7XG4gICAgICByZXR1cm4gbmF0aXZlUmVtb3ZlRXZlbnRMaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgICB2YXIgdW53cmFwcGVkQ2IgPSB0aGlzLl9ldmVudE1hcFtjYl07XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50TWFwW2NiXTtcbiAgICByZXR1cm4gbmF0aXZlUmVtb3ZlRXZlbnRMaXN0ZW5lci5hcHBseSh0aGlzLCBbbmF0aXZlRXZlbnROYW1lLFxuICAgICAgdW53cmFwcGVkQ2JdKTtcbiAgfTtcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG8sICdvbicgKyBldmVudE5hbWVUb1dyYXAsIHtcbiAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXNbJ19vbicgKyBldmVudE5hbWVUb1dyYXBdO1xuICAgIH0sXG4gICAgc2V0OiBmdW5jdGlvbihjYikge1xuICAgICAgaWYgKHRoaXNbJ19vbicgKyBldmVudE5hbWVUb1dyYXBdKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWVUb1dyYXAsXG4gICAgICAgICAgICB0aGlzWydfb24nICsgZXZlbnROYW1lVG9XcmFwXSk7XG4gICAgICAgIGRlbGV0ZSB0aGlzWydfb24nICsgZXZlbnROYW1lVG9XcmFwXTtcbiAgICAgIH1cbiAgICAgIGlmIChjYikge1xuICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lVG9XcmFwLFxuICAgICAgICAgICAgdGhpc1snX29uJyArIGV2ZW50TmFtZVRvV3JhcF0gPSBjYik7XG4gICAgICB9XG4gICAgfSxcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICB9KTtcbn1cblxuLy8gVXRpbGl0eSBtZXRob2RzLlxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGV4dHJhY3RWZXJzaW9uOiBleHRyYWN0VmVyc2lvbixcbiAgd3JhcFBlZXJDb25uZWN0aW9uRXZlbnQ6IHdyYXBQZWVyQ29ubmVjdGlvbkV2ZW50LFxuICBkaXNhYmxlTG9nOiBmdW5jdGlvbihib29sKSB7XG4gICAgaWYgKHR5cGVvZiBib29sICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHJldHVybiBuZXcgRXJyb3IoJ0FyZ3VtZW50IHR5cGU6ICcgKyB0eXBlb2YgYm9vbCArXG4gICAgICAgICAgJy4gUGxlYXNlIHVzZSBhIGJvb2xlYW4uJyk7XG4gICAgfVxuICAgIGxvZ0Rpc2FibGVkXyA9IGJvb2w7XG4gICAgcmV0dXJuIChib29sKSA/ICdhZGFwdGVyLmpzIGxvZ2dpbmcgZGlzYWJsZWQnIDpcbiAgICAgICAgJ2FkYXB0ZXIuanMgbG9nZ2luZyBlbmFibGVkJztcbiAgfSxcblxuICAvKipcbiAgICogRGlzYWJsZSBvciBlbmFibGUgZGVwcmVjYXRpb24gd2FybmluZ3NcbiAgICogQHBhcmFtIHshYm9vbGVhbn0gYm9vbCBzZXQgdG8gdHJ1ZSB0byBkaXNhYmxlIHdhcm5pbmdzLlxuICAgKi9cbiAgZGlzYWJsZVdhcm5pbmdzOiBmdW5jdGlvbihib29sKSB7XG4gICAgaWYgKHR5cGVvZiBib29sICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHJldHVybiBuZXcgRXJyb3IoJ0FyZ3VtZW50IHR5cGU6ICcgKyB0eXBlb2YgYm9vbCArXG4gICAgICAgICAgJy4gUGxlYXNlIHVzZSBhIGJvb2xlYW4uJyk7XG4gICAgfVxuICAgIGRlcHJlY2F0aW9uV2FybmluZ3NfID0gIWJvb2w7XG4gICAgcmV0dXJuICdhZGFwdGVyLmpzIGRlcHJlY2F0aW9uIHdhcm5pbmdzICcgKyAoYm9vbCA/ICdkaXNhYmxlZCcgOiAnZW5hYmxlZCcpO1xuICB9LFxuXG4gIGxvZzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAobG9nRGlzYWJsZWRfKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgY29uc29sZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIGNvbnNvbGUubG9nID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cyk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBTaG93cyBhIGRlcHJlY2F0aW9uIHdhcm5pbmcgc3VnZ2VzdGluZyB0aGUgbW9kZXJuIGFuZCBzcGVjLWNvbXBhdGlibGUgQVBJLlxuICAgKi9cbiAgZGVwcmVjYXRlZDogZnVuY3Rpb24ob2xkTWV0aG9kLCBuZXdNZXRob2QpIHtcbiAgICBpZiAoIWRlcHJlY2F0aW9uV2FybmluZ3NfKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnNvbGUud2FybihvbGRNZXRob2QgKyAnIGlzIGRlcHJlY2F0ZWQsIHBsZWFzZSB1c2UgJyArIG5ld01ldGhvZCArXG4gICAgICAgICcgaW5zdGVhZC4nKTtcbiAgfSxcblxuICAvKipcbiAgICogQnJvd3NlciBkZXRlY3Rvci5cbiAgICpcbiAgICogQHJldHVybiB7b2JqZWN0fSByZXN1bHQgY29udGFpbmluZyBicm93c2VyIGFuZCB2ZXJzaW9uXG4gICAqICAgICBwcm9wZXJ0aWVzLlxuICAgKi9cbiAgZGV0ZWN0QnJvd3NlcjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIG5hdmlnYXRvciA9IHdpbmRvdyAmJiB3aW5kb3cubmF2aWdhdG9yO1xuXG4gICAgLy8gUmV0dXJuZWQgcmVzdWx0IG9iamVjdC5cbiAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgcmVzdWx0LmJyb3dzZXIgPSBudWxsO1xuICAgIHJlc3VsdC52ZXJzaW9uID0gbnVsbDtcblxuICAgIC8vIEZhaWwgZWFybHkgaWYgaXQncyBub3QgYSBicm93c2VyXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnIHx8ICF3aW5kb3cubmF2aWdhdG9yKSB7XG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdOb3QgYSBicm93c2VyLic7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGlmIChuYXZpZ2F0b3IubW96R2V0VXNlck1lZGlhKSB7IC8vIEZpcmVmb3guXG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdmaXJlZm94JztcbiAgICAgIHJlc3VsdC52ZXJzaW9uID0gZXh0cmFjdFZlcnNpb24obmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgICAvRmlyZWZveFxcLyhcXGQrKVxcLi8sIDEpO1xuICAgIH0gZWxzZSBpZiAobmF2aWdhdG9yLndlYmtpdEdldFVzZXJNZWRpYSkge1xuICAgICAgLy8gQ2hyb21lLCBDaHJvbWl1bSwgV2VidmlldywgT3BlcmEuXG4gICAgICAvLyBWZXJzaW9uIG1hdGNoZXMgQ2hyb21lL1dlYlJUQyB2ZXJzaW9uLlxuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnY2hyb21lJztcbiAgICAgIHJlc3VsdC52ZXJzaW9uID0gZXh0cmFjdFZlcnNpb24obmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgICAvQ2hyb20oZXxpdW0pXFwvKFxcZCspXFwuLywgMik7XG4gICAgfSBlbHNlIGlmIChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzICYmXG4gICAgICAgIG5hdmlnYXRvci51c2VyQWdlbnQubWF0Y2goL0VkZ2VcXC8oXFxkKykuKFxcZCspJC8pKSB7IC8vIEVkZ2UuXG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdlZGdlJztcbiAgICAgIHJlc3VsdC52ZXJzaW9uID0gZXh0cmFjdFZlcnNpb24obmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgICAvRWRnZVxcLyhcXGQrKS4oXFxkKykkLywgMik7XG4gICAgfSBlbHNlIGlmICh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgbmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvQXBwbGVXZWJLaXRcXC8oXFxkKylcXC4vKSkgeyAvLyBTYWZhcmkuXG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdzYWZhcmknO1xuICAgICAgcmVzdWx0LnZlcnNpb24gPSBleHRyYWN0VmVyc2lvbihuYXZpZ2F0b3IudXNlckFnZW50LFxuICAgICAgICAgIC9BcHBsZVdlYktpdFxcLyhcXGQrKVxcLi8sIDEpO1xuICAgIH0gZWxzZSB7IC8vIERlZmF1bHQgZmFsbHRocm91Z2g6IG5vdCBzdXBwb3J0ZWQuXG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdOb3QgYSBzdXBwb3J0ZWQgYnJvd3Nlci4nO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5pbXBvcnQgTWljVGVzdCBmcm9tICcuLi91bml0L21pYy5qcyc7XG5pbXBvcnQgUnVuQ29ubmVjdGl2aXR5VGVzdCBmcm9tICcuLi91bml0L2Nvbm4uanMnO1xuaW1wb3J0IENhbVJlc29sdXRpb25zVGVzdCBmcm9tICcuLi91bml0L2NhbXJlc29sdXRpb25zLmpzJztcbmltcG9ydCBOZXR3b3JrVGVzdCBmcm9tICcuLi91bml0L25ldC5qcyc7XG5pbXBvcnQgRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdCBmcm9tICcuLi91bml0L2RhdGFCYW5kd2lkdGguanMnO1xuaW1wb3J0IFZpZGVvQmFuZHdpZHRoVGVzdCBmcm9tICcuLi91bml0L3ZpZGVvQmFuZHdpZHRoLmpzJztcbmltcG9ydCBXaUZpUGVyaW9kaWNTY2FuVGVzdCBmcm9tICcuLi91bml0L3dpZmlQZXJpb2RpY1NjYW4uanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9jYWxsLmpzJztcblxuaW1wb3J0IFN1aXRlIGZyb20gJy4vc3VpdGUuanMnO1xuaW1wb3J0IFRlc3RDYXNlIGZyb20gJy4vdGVzdENhc2UuanMnO1xuXG5leHBvcnQgY29uc3QgVEVTVFMgPSB7XG4gIEFVRElPQ0FQVFVSRTogJ0F1ZGlvIGNhcHR1cmUnLFxuICBDSEVDS1JFU09MVVRJT04yNDA6ICdDaGVjayByZXNvbHV0aW9uIDMyMHgyNDAnLFxuICBDSEVDS1JFU09MVVRJT040ODA6ICdDaGVjayByZXNvbHV0aW9uIDY0MHg0ODAnLFxuICBDSEVDS1JFU09MVVRJT043MjA6ICdDaGVjayByZXNvbHV0aW9uIDEyODB4NzIwJyxcbiAgQ0hFQ0tTVVBQT1JURURSRVNPTFVUSU9OUzogJ0NoZWNrIHN1cHBvcnRlZCByZXNvbHV0aW9ucycsXG4gIERBVEFUSFJPVUdIUFVUOiAnRGF0YSB0aHJvdWdocHV0JyxcbiAgSVBWNkVOQUJMRUQ6ICdJcHY2IGVuYWJsZWQnLFxuICBORVRXT1JLTEFURU5DWTogJ05ldHdvcmsgbGF0ZW5jeScsXG4gIE5FVFdPUktMQVRFTkNZUkVMQVk6ICdOZXR3b3JrIGxhdGVuY3kgLSBSZWxheScsXG4gIFVEUEVOQUJMRUQ6ICdVZHAgZW5hYmxlZCcsXG4gIFRDUEVOQUJMRUQ6ICdUY3AgZW5hYmxlZCcsXG4gIFZJREVPQkFORFdJRFRIOiAnVmlkZW8gYmFuZHdpZHRoJyxcbiAgUkVMQVlDT05ORUNUSVZJVFk6ICdSZWxheSBjb25uZWN0aXZpdHknLFxuICBSRUZMRVhJVkVDT05ORUNUSVZJVFk6ICdSZWZsZXhpdmUgY29ubmVjdGl2aXR5JyxcbiAgSE9TVENPTk5FQ1RJVklUWTogJ0hvc3QgY29ubmVjdGl2aXR5J1xufTtcblxuZXhwb3J0IGNvbnN0IFNVSVRFUyA9IHtcbiAgICBDQU1FUkE6ICdDYW1lcmEnLFxuICAgIE1JQ1JPUEhPTkU6ICdNaWNyb3Bob25lJyxcbiAgICBORVRXT1JLOiAnTmV0d29yaycsXG4gICAgQ09OTkVDVElWSVRZOiAnQ29ubmVjdGl2aXR5JyxcbiAgICBUSFJPVUdIUFVUOiAnVGhyb3VnaHB1dCdcbiAgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkTWljcm9TdWl0ZShjb25maWcpIHtcbiAgY29uc3QgbWljU3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLk1JQ1JPUEhPTkUsIGNvbmZpZyk7XG4gIG1pY1N1aXRlLmFkZChuZXcgVGVzdENhc2UobWljU3VpdGUsIFRFU1RTLkFVRElPQ0FQVFVSRSwgKHRlc3QpID0+IHtcbiAgICB2YXIgbWljVGVzdCA9IG5ldyBNaWNUZXN0KHRlc3QpO1xuICAgIG1pY1Rlc3QucnVuKCk7XG4gIH0pKTtcbiAgcmV0dXJuIG1pY1N1aXRlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYW1lcmFTdWl0ZShjb25maWcpIHtcbiAgY29uc3QgY2FtZXJhU3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLkNBTUVSQSwgY29uZmlnKTtcbiAgY2FtZXJhU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjYW1lcmFTdWl0ZSwgVEVTVFMuQ0hFQ0tSRVNPTFVUSU9OMjQwLCAodGVzdCkgPT4ge1xuICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QgLCBbWzMyMCwgMjQwXV0pO1xuICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgfSkpO1xuICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1JFU09MVVRJT040ODAsICh0ZXN0KSA9PiB7XG4gICAgdmFyIGNhbVJlc29sdXRpb25zVGVzdCA9IG5ldyBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgW1s2NDAsIDQ4MF1dKTtcbiAgICBjYW1SZXNvbHV0aW9uc1Rlc3QucnVuKCk7XG4gIH0pKTtcbiAgY2FtZXJhU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjYW1lcmFTdWl0ZSwgVEVTVFMuQ0hFQ0tSRVNPTFVUSU9ONzIwLCAodGVzdCkgPT4ge1xuICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QsIFtbMTI4MCwgNzIwXV0pO1xuICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgfSkpO1xuICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1NVUFBPUlRFRFJFU09MVVRJT05TLCAodGVzdCkgPT4ge1xuICAgIHZhciByZXNvbHV0aW9uQXJyYXkgPSBbXG4gICAgICBbMTYwLCAxMjBdLCBbMzIwLCAxODBdLCBbMzIwLCAyNDBdLCBbNjQwLCAzNjBdLCBbNjQwLCA0ODBdLCBbNzY4LCA1NzZdLFxuICAgICAgWzEwMjQsIDU3Nl0sIFsxMjgwLCA3MjBdLCBbMTI4MCwgNzY4XSwgWzEyODAsIDgwMF0sIFsxOTIwLCAxMDgwXSxcbiAgICAgIFsxOTIwLCAxMjAwXSwgWzM4NDAsIDIxNjBdLCBbNDA5NiwgMjE2MF1cbiAgICBdO1xuICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QsIHJlc29sdXRpb25BcnJheSk7XG4gICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICB9KSk7XG4gIHJldHVybiBjYW1lcmFTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkTmV0d29ya1N1aXRlKGNvbmZpZykge1xuICBjb25zdCBuZXR3b3JrU3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLk5FVFdPUkssIGNvbmZpZyk7XG4gIC8vIFRlc3Qgd2hldGhlciBpdCBjYW4gY29ubmVjdCB2aWEgVURQIHRvIGEgVFVSTiBzZXJ2ZXJcbiAgLy8gR2V0IGEgVFVSTiBjb25maWcsIGFuZCB0cnkgdG8gZ2V0IGEgcmVsYXkgY2FuZGlkYXRlIHVzaW5nIFVEUC5cbiAgbmV0d29ya1N1aXRlLmFkZChuZXcgVGVzdENhc2UobmV0d29ya1N1aXRlLCBURVNUUy5VRFBFTkFCTEVELCAodGVzdCkgPT4ge1xuICAgIHZhciBuZXR3b3JrVGVzdCA9IG5ldyBOZXR3b3JrVGVzdCh0ZXN0LCAndWRwJywgbnVsbCwgQ2FsbC5pc1JlbGF5KTtcbiAgICBuZXR3b3JrVGVzdC5ydW4oKTtcbiAgfSkpO1xuICAvLyBUZXN0IHdoZXRoZXIgaXQgY2FuIGNvbm5lY3QgdmlhIFRDUCB0byBhIFRVUk4gc2VydmVyXG4gIC8vIEdldCBhIFRVUk4gY29uZmlnLCBhbmQgdHJ5IHRvIGdldCBhIHJlbGF5IGNhbmRpZGF0ZSB1c2luZyBUQ1AuXG4gIG5ldHdvcmtTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKG5ldHdvcmtTdWl0ZSwgVEVTVFMuVENQRU5BQkxFRCwgKHRlc3QpID0+IHtcbiAgICB2YXIgbmV0d29ya1Rlc3QgPSBuZXcgTmV0d29ya1Rlc3QodGVzdCwgJ3RjcCcsIG51bGwsIENhbGwuaXNSZWxheSk7XG4gICAgbmV0d29ya1Rlc3QucnVuKCk7XG4gIH0pKTtcbiAgLy8gVGVzdCB3aGV0aGVyIGl0IGlzIElQdjYgZW5hYmxlZCAoVE9ETzogdGVzdCBJUHY2IHRvIGEgZGVzdGluYXRpb24pLlxuICAvLyBUdXJuIG9uIElQdjYsIGFuZCB0cnkgdG8gZ2V0IGFuIElQdjYgaG9zdCBjYW5kaWRhdGUuXG4gIG5ldHdvcmtTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKG5ldHdvcmtTdWl0ZSwgVEVTVFMuSVBWNkVOQUJMRUQsICh0ZXN0KSA9PiB7XG4gICAgdmFyIHBhcmFtcyA9IHtvcHRpb25hbDogW3tnb29nSVB2NjogdHJ1ZX1dfTtcbiAgICB2YXIgbmV0d29ya1Rlc3QgPSBuZXcgTmV0d29ya1Rlc3QodGVzdCwgbnVsbCwgcGFyYW1zLCBDYWxsLmlzSXB2Nik7XG4gICAgbmV0d29ya1Rlc3QucnVuKCk7XG4gIH0pKTtcbiAgcmV0dXJuIG5ldHdvcmtTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ29ubmVjdGl2aXR5U3VpdGUoY29uZmlnKSB7XG4gIGNvbnN0IGNvbm5lY3Rpdml0eVN1aXRlID0gbmV3IFN1aXRlKFNVSVRFUy5DT05ORUNUSVZJVFksIGNvbmZpZyk7XG4gIC8vIFNldCB1cCBhIGRhdGFjaGFubmVsIGJldHdlZW4gdHdvIHBlZXJzIHRocm91Z2ggYSByZWxheVxuICAvLyBhbmQgdmVyaWZ5IGRhdGEgY2FuIGJlIHRyYW5zbWl0dGVkIGFuZCByZWNlaXZlZFxuICAvLyAocGFja2V0cyB0cmF2ZWwgdGhyb3VnaCB0aGUgcHVibGljIGludGVybmV0KVxuICBjb25uZWN0aXZpdHlTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNvbm5lY3Rpdml0eVN1aXRlLCBURVNUUy5SRUxBWUNPTk5FQ1RJVklUWSwgKHRlc3QpID0+IHtcbiAgICB2YXIgcnVuQ29ubmVjdGl2aXR5VGVzdCA9IG5ldyBSdW5Db25uZWN0aXZpdHlUZXN0KHRlc3QsIENhbGwuaXNSZWxheSk7XG4gICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5ydW4oKTtcbiAgfSkpO1xuICAvLyBTZXQgdXAgYSBkYXRhY2hhbm5lbCBiZXR3ZWVuIHR3byBwZWVycyB0aHJvdWdoIGEgcHVibGljIElQIGFkZHJlc3NcbiAgLy8gYW5kIHZlcmlmeSBkYXRhIGNhbiBiZSB0cmFuc21pdHRlZCBhbmQgcmVjZWl2ZWRcbiAgLy8gKHBhY2tldHMgc2hvdWxkIHN0YXkgb24gdGhlIGxpbmsgaWYgYmVoaW5kIGEgcm91dGVyIGRvaW5nIE5BVClcbiAgY29ubmVjdGl2aXR5U3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjb25uZWN0aXZpdHlTdWl0ZSwgVEVTVFMuUkVGTEVYSVZFQ09OTkVDVElWSVRZLCAodGVzdCkgPT4ge1xuICAgIHZhciBydW5Db25uZWN0aXZpdHlUZXN0ID0gbmV3IFJ1bkNvbm5lY3Rpdml0eVRlc3QodGVzdCwgQ2FsbC5pc1JlZmxleGl2ZSk7XG4gICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5ydW4oKTtcbiAgfSkpO1xuICAvLyBTZXQgdXAgYSBkYXRhY2hhbm5lbCBiZXR3ZWVuIHR3byBwZWVycyB0aHJvdWdoIGEgbG9jYWwgSVAgYWRkcmVzc1xuICAvLyBhbmQgdmVyaWZ5IGRhdGEgY2FuIGJlIHRyYW5zbWl0dGVkIGFuZCByZWNlaXZlZFxuICAvLyAocGFja2V0cyBzaG91bGQgbm90IGxlYXZlIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHRlc3QpXG4gIGNvbm5lY3Rpdml0eVN1aXRlLmFkZChuZXcgVGVzdENhc2UoY29ubmVjdGl2aXR5U3VpdGUsIFRFU1RTLkhPU1RDT05ORUNUSVZJVFksICh0ZXN0KSA9PiB7XG4gICAgdmFyIHJ1bkNvbm5lY3Rpdml0eVRlc3QgPSBuZXcgUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBDYWxsLmlzSG9zdCk7XG4gICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5zdGFydCgpO1xuICB9KSk7XG4gIHJldHVybiBjb25uZWN0aXZpdHlTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGhyb3VnaHB1dFN1aXRlKGNvbmZpZykge1xuICBjb25zdCB0aHJvdWdocHV0U3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLlRIUk9VR0hQVVQsIGNvbmZpZyk7XG4gIC8vIENyZWF0ZXMgYSBsb29wYmFjayB2aWEgcmVsYXkgY2FuZGlkYXRlcyBhbmQgdHJpZXMgdG8gc2VuZCBhcyBtYW55IHBhY2tldHNcbiAgLy8gd2l0aCAxMDI0IGNoYXJzIGFzIHBvc3NpYmxlIHdoaWxlIGtlZXBpbmcgZGF0YUNoYW5uZWwgYnVmZmVyZWRBbW1vdW50IGFib3ZlXG4gIC8vIHplcm8uXG4gIHRocm91Z2hwdXRTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKHRocm91Z2hwdXRTdWl0ZSwgVEVTVFMuREFUQVRIUk9VR0hQVVQsICh0ZXN0KSA9PiB7XG4gICAgdmFyIGRhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QgPSBuZXcgRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdCh0ZXN0KTtcbiAgICBkYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0LnJ1bigpO1xuICB9KSk7XG4gIC8vIE1lYXN1cmVzIHZpZGVvIGJhbmR3aWR0aCBlc3RpbWF0aW9uIHBlcmZvcm1hbmNlIGJ5IGRvaW5nIGEgbG9vcGJhY2sgY2FsbCB2aWFcbiAgLy8gcmVsYXkgY2FuZGlkYXRlcyBmb3IgNDAgc2Vjb25kcy4gQ29tcHV0ZXMgcnR0IGFuZCBiYW5kd2lkdGggZXN0aW1hdGlvblxuICAvLyBhdmVyYWdlIGFuZCBtYXhpbXVtIGFzIHdlbGwgYXMgdGltZSB0byByYW1wIHVwIChkZWZpbmVkIGFzIHJlYWNoaW5nIDc1JSBvZlxuICAvLyB0aGUgbWF4IGJpdHJhdGUuIEl0IHJlcG9ydHMgaW5maW5pdGUgdGltZSB0byByYW1wIHVwIGlmIG5ldmVyIHJlYWNoZXMgaXQuXG4gIHRocm91Z2hwdXRTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKHRocm91Z2hwdXRTdWl0ZSwgVEVTVFMuVklERU9CQU5EV0lEVEgsICh0ZXN0KSA9PiB7XG4gICAgdmFyIHZpZGVvQmFuZHdpZHRoVGVzdCA9IG5ldyBWaWRlb0JhbmR3aWR0aFRlc3QodGVzdCk7XG4gICAgdmlkZW9CYW5kd2lkdGhUZXN0LnJ1bigpO1xuICB9KSk7XG4gIHRocm91Z2hwdXRTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKHRocm91Z2hwdXRTdWl0ZSwgVEVTVFMuTkVUV09SS0xBVEVOQ1ksICh0ZXN0KSA9PiB7XG4gICAgdmFyIHdpRmlQZXJpb2RpY1NjYW5UZXN0ID0gbmV3IFdpRmlQZXJpb2RpY1NjYW5UZXN0KHRlc3QsXG4gICAgICAgIENhbGwuaXNOb3RIb3N0Q2FuZGlkYXRlKTtcbiAgICB3aUZpUGVyaW9kaWNTY2FuVGVzdC5ydW4oKTtcbiAgfSkpO1xuICB0aHJvdWdocHV0U3VpdGUuYWRkKG5ldyBUZXN0Q2FzZSh0aHJvdWdocHV0U3VpdGUsIFRFU1RTLk5FVFdPUktMQVRFTkNZUkVMQVksICh0ZXN0KSA9PiB7XG4gICAgdmFyIHdpRmlQZXJpb2RpY1NjYW5UZXN0ID0gbmV3IFdpRmlQZXJpb2RpY1NjYW5UZXN0KHRlc3QsIENhbGwuaXNSZWxheSk7XG4gICAgd2lGaVBlcmlvZGljU2NhblRlc3QucnVuKCk7XG4gIH0pKTtcbiAgcmV0dXJuIHRocm91Z2hwdXRTdWl0ZTtcbn1cbiIsImNsYXNzIFN1aXRlIHtcbiAgY29uc3RydWN0b3IobmFtZSwgY29uZmlnKSB7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB0aGlzLnNldHRpbmdzID0gY29uZmlnO1xuICAgIHRoaXMudGVzdHMgPSBbXTtcbiAgfVxuXG4gIGdldFRlc3RzKCkge1xuICAgIHJldHVybiB0aGlzLnRlc3RzO1xuICB9XG5cbiAgYWRkKHRlc3QpIHtcbiAgICB0aGlzLnRlc3RzLnB1c2godGVzdCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3VpdGU7XG4iLCJjbGFzcyBUZXN0Q2FzZSB7XG4gIGNvbnN0cnVjdG9yKHN1aXRlLCBuYW1lLCBmbikge1xuICAgIHRoaXMuc3VpdGUgPSBzdWl0ZTtcbiAgICB0aGlzLnNldHRpbmdzID0gdGhpcy5zdWl0ZS5zZXR0aW5ncztcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMuZm4gPSBmbjtcbiAgICB0aGlzLnByb2dyZXNzID0gMDtcbiAgICB0aGlzLnN0YXR1cyA9ICd3YWl0aW5nJztcbiAgfVxuXG4gIHNldFByb2dyZXNzKHZhbHVlKSB7XG4gICAgdGhpcy5wcm9ncmVzcyA9IHZhbHVlO1xuICAgIHRoaXMudXBkYXRlQ2FsbGJhY2sodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsIHZhbHVlKTtcbiAgfVxuXG4gIHJ1bih1cGRhdGVDYWxsYmFjaywgcmVzdWx0Q2FsbGJhY2ssIGRvbmVDYWxsYmFjaykge1xuICAgIHRoaXMuZm4odGhpcyk7XG4gICAgdGhpcy51cGRhdGVDYWxsYmFjayA9IHVwZGF0ZUNhbGxiYWNrO1xuICAgIHRoaXMucmVzdWx0Q2FsbGJhY2sgPSByZXN1bHRDYWxsYmFjaztcbiAgICB0aGlzLmRvbmVDYWxsYmFjayA9IGRvbmVDYWxsYmFjaztcbiAgICB0aGlzLnNldFByb2dyZXNzKDApO1xuICB9XG5cbiAgcmVwb3J0SW5mbyhtKSB7XG4gICAgY29uc29sZS5pbmZvKGBbJHt0aGlzLnN1aXRlLm5hbWV9IC0gJHt0aGlzLm5hbWV9XSAke219YCk7XG4gIH1cbiAgcmVwb3J0U3VjY2VzcyhtKSB7XG4gICAgY29uc29sZS5pbmZvKGBbJHt0aGlzLnN1aXRlLm5hbWV9IC0gJHt0aGlzLm5hbWV9XSAke219YCk7XG4gICAgdGhpcy5zdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIH1cbiAgcmVwb3J0RXJyb3IobSkge1xuICAgIGNvbnNvbGUuZXJyb3IoYFske3RoaXMuc3VpdGUubmFtZX0gLSAke3RoaXMubmFtZX1dICR7bX1gKTtcbiAgICB0aGlzLnN0YXR1cyA9ICdlcnJvcic7XG4gIH1cbiAgcmVwb3J0V2FybmluZyhtKSB7XG4gICAgY29uc29sZS53YXJuKGBbJHt0aGlzLnN1aXRlLm5hbWV9IC0gJHt0aGlzLm5hbWV9XSAke219YCk7XG4gICAgdGhpcy5zdGF0dXMgPSAnd2FybmluZyc7XG4gIH1cbiAgcmVwb3J0RmF0YWwobSkge1xuICAgIGNvbnNvbGUuZXJyb3IoYFske3RoaXMuc3VpdGUubmFtZX0gLSAke3RoaXMubmFtZX1dICR7bX1gKTtcbiAgICB0aGlzLnN0YXR1cyA9ICdlcnJvcic7XG4gIH1cbiAgZG9uZSgpIHtcbiAgICBpZiAodGhpcy5wcm9ncmVzcyAhPT0gMTAwKSB0aGlzLnNldFByb2dyZXNzKDEwMCk7XG4gICAgdGhpcy5yZXN1bHRDYWxsYmFjayh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgdGhpcy5zdGF0dXMpO1xuICAgIHRoaXMuZG9uZUNhbGxiYWNrKCk7XG4gIH1cblxuICBkb0dldFVzZXJNZWRpYShjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkZhaWwpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdHJ5IHtcbiAgICAgIC8vIENhbGwgaW50byBnZXRVc2VyTWVkaWEgdmlhIHRoZSBwb2x5ZmlsbCAoYWRhcHRlci5qcykuXG4gICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cylcbiAgICAgICAgICAudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIHZhciBjYW0gPSBzZWxmLmdldERldmljZU5hbWVfKHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpKTtcbiAgICAgICAgICAgIHZhciBtaWMgPSBzZWxmLmdldERldmljZU5hbWVfKHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpKTtcbiAgICAgICAgICAgIG9uU3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAob25GYWlsKSB7XG4gICAgICAgICAgICAgIG9uRmFpbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgc2VsZi5yZXBvcnRGYXRhbCgnRmFpbGVkIHRvIGdldCBhY2Nlc3MgdG8gbG9jYWwgbWVkaWEgZHVlIHRvICcgK1xuICAgICAgICAgICAgICAgICAgJ2Vycm9yOiAnICsgZXJyb3IubmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHRoaXMucmVwb3J0RmF0YWwoJ2dldFVzZXJNZWRpYSBmYWlsZWQgd2l0aCBleGNlcHRpb246ICcgK1xuICAgICAgICAgIGUubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgc2V0VGltZW91dFdpdGhQcm9ncmVzc0Jhcih0aW1lb3V0Q2FsbGJhY2ssIHRpbWVvdXRNcykge1xuICAgIHZhciBzdGFydCA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHVwZGF0ZVByb2dyZXNzQmFyID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgbm93ID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpO1xuICAgICAgc2VsZi5zZXRQcm9ncmVzcygobm93IC0gc3RhcnQpICogMTAwIC8gdGltZW91dE1zKTtcbiAgICB9LCAxMDApO1xuICAgIHZhciB0aW1lb3V0VGFzayA9IGZ1bmN0aW9uKCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh1cGRhdGVQcm9ncmVzc0Jhcik7XG4gICAgICBzZWxmLnNldFByb2dyZXNzKDEwMCk7XG4gICAgICB0aW1lb3V0Q2FsbGJhY2soKTtcbiAgICB9O1xuICAgIHZhciB0aW1lciA9IHNldFRpbWVvdXQodGltZW91dFRhc2ssIHRpbWVvdXRNcyk7XG4gICAgdmFyIGZpbmlzaFByb2dyZXNzQmFyID0gZnVuY3Rpb24oKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgdGltZW91dFRhc2soKTtcbiAgICB9O1xuICAgIHJldHVybiBmaW5pc2hQcm9ncmVzc0JhcjtcbiAgfVxuXG4gIGdldERldmljZU5hbWVfKHRyYWNrcykge1xuICAgIGlmICh0cmFja3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIHRyYWNrc1swXS5sYWJlbDtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBUZXN0Q2FzZTtcbiIsImltcG9ydCAqIGFzIENvbmZpZyBmcm9tICcuL2NvbmZpZyc7XG5cbmZ1bmN0aW9uIHJ1bkFsbFNlcXVlbnRpYWxseSh0YXNrcywgcHJvZ3Jlc3NDYWxsYmFjaywgcmVzdWx0Q2FsbGJhY2ssIGRvbmVDYWxsYmFjaykge1xuICB2YXIgY3VycmVudCA9IC0xO1xuICB2YXIgcnVuTmV4dEFzeW5jID0gc2V0VGltZW91dC5iaW5kKG51bGwsIHJ1bk5leHQpO1xuICBydW5OZXh0QXN5bmMoKTtcbiAgZnVuY3Rpb24gcnVuTmV4dCgpIHtcbiAgICBjdXJyZW50Kys7XG4gICAgaWYgKGN1cnJlbnQgPT09IHRhc2tzLmxlbmd0aCkge1xuICAgICAgZG9uZUNhbGxiYWNrKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRhc2tzW2N1cnJlbnRdLnJ1bihwcm9ncmVzc0NhbGxiYWNrLCByZXN1bHRDYWxsYmFjaywgcnVuTmV4dEFzeW5jKTtcbiAgfVxufVxuXG5jbGFzcyBUZXN0UlRDIHtcblxuICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgIHRoaXMuU1VJVEVTID0gQ29uZmlnLlNVSVRFUztcbiAgICB0aGlzLlRFU1RTID0gQ29uZmlnLlRFU1RTO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuXG4gICAgdGhpcy5zdWl0ZXMgPSBbXTtcblxuICAgIGNvbnN0IG1pY1N1aXRlID0gQ29uZmlnLmJ1aWxkTWljcm9TdWl0ZSh0aGlzLmNvbmZpZyk7XG4gICAgY29uc3QgY2FtZXJhU3VpdGUgPSBDb25maWcuYnVpbGRDYW1lcmFTdWl0ZSh0aGlzLmNvbmZpZyk7XG4gICAgY29uc3QgbmV0d29ya1N1aXRlID0gQ29uZmlnLmJ1aWxkTmV0d29ya1N1aXRlKHRoaXMuY29uZmlnKTtcbiAgICBjb25zdCBjb25uZWN0aXZpdHlTdWl0ZSA9IENvbmZpZy5idWlsZENvbm5lY3Rpdml0eVN1aXRlKHRoaXMuY29uZmlnKTtcbiAgICBjb25zdCB0aHJvdWdocHV0U3VpdGUgPSBDb25maWcuYnVpbGRUaHJvdWdocHV0U3VpdGUodGhpcy5jb25maWcpO1xuXG4gICAgdGhpcy5zdWl0ZXMucHVzaChtaWNTdWl0ZSk7XG4gICAgdGhpcy5zdWl0ZXMucHVzaChjYW1lcmFTdWl0ZSk7XG4gICAgdGhpcy5zdWl0ZXMucHVzaChuZXR3b3JrU3VpdGUpO1xuICAgIHRoaXMuc3VpdGVzLnB1c2goY29ubmVjdGl2aXR5U3VpdGUpO1xuICAgIHRoaXMuc3VpdGVzLnB1c2godGhyb3VnaHB1dFN1aXRlKTtcbiAgfVxuXG4gIGdldFN1aXRlcygpIHtcbiAgICByZXR1cm4gdGhpcy5zdWl0ZXM7XG4gIH1cblxuICBnZXRUZXN0cygpIHtcbiAgICByZXR1cm4gdGhpcy5zdWl0ZXMucmVkdWNlKChhbGwsIHN1aXRlKSA9PiBhbGwuY29uY2F0KHN1aXRlLmdldFRlc3RzKCkpLCBbXSk7XG4gIH1cblxuICBzdGFydChvblRlc3RQcm9ncmVzcyA9ICgpID0+IHt9LCBvblRlc3RSZXN1bHQgPSAoKSA9PiB7fSwgb25Db21wbGV0ZSA9ICgpID0+IHt9KSB7XG4gICAgY29uc3QgYWxsVGVzdHMgPSB0aGlzLmdldFRlc3RzKCk7XG4gICAgcnVuQWxsU2VxdWVudGlhbGx5KGFsbFRlc3RzLCBvblRlc3RQcm9ncmVzcywgb25UZXN0UmVzdWx0LCBvbkNvbXBsZXRlKTtcbiAgfVxufVxuXG53aW5kb3cuVGVzdFJUQyA9IFRlc3RSVEM7XG5leHBvcnQgZGVmYXVsdCBUZXN0UlRDO1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFZpZGVvRnJhbWVDaGVja2VyIGZyb20gJy4uL3V0aWwvVmlkZW9GcmFtZUNoZWNrZXIuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi4vdXRpbC9yZXBvcnQuanMnO1xuaW1wb3J0IHsgYXJyYXlBdmVyYWdlLCBhcnJheU1pbiwgYXJyYXlNYXggfSBmcm9tICcuLi91dGlsL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG4vKlxuICogSW4gZ2VuZXJpYyBjYW1lcmFzIHVzaW5nIENocm9tZSByZXNjYWxlciwgYWxsIHJlc29sdXRpb25zIHNob3VsZCBiZSBzdXBwb3J0ZWRcbiAqIHVwIHRvIGEgZ2l2ZW4gb25lIGFuZCBub25lIGJleW9uZCB0aGVyZS4gU3BlY2lhbCBjYW1lcmFzLCBzdWNoIGFzIGRpZ2l0aXplcnMsXG4gKiBtaWdodCBzdXBwb3J0IG9ubHkgb25lIHJlc29sdXRpb24uXG4gKi9cblxuLypcbiAqIFwiQW5hbHl6ZSBwZXJmb3JtYW5jZSBmb3IgXCJyZXNvbHV0aW9uXCJcIiB0ZXN0IHVzZXMgZ2V0U3RhdHMsIGNhbnZhcyBhbmQgdGhlXG4gKiB2aWRlbyBlbGVtZW50IHRvIGFuYWx5emUgdGhlIHZpZGVvIGZyYW1lcyBmcm9tIGEgY2FwdHVyZSBkZXZpY2UuIEl0IHdpbGxcbiAqIHJlcG9ydCBudW1iZXIgb2YgYmxhY2sgZnJhbWVzLCBmcm96ZW4gZnJhbWVzLCB0ZXN0ZWQgZnJhbWVzIGFuZCB2YXJpb3VzIHN0YXRzXG4gKiBsaWtlIGF2ZXJhZ2UgZW5jb2RlIHRpbWUgYW5kIEZQUy4gQSB0ZXN0IGNhc2Ugd2lsbCBiZSBjcmVhdGVkIHBlciBtYW5kYXRvcnlcbiAqIHJlc29sdXRpb24gZm91bmQgaW4gdGhlIFwicmVzb2x1dGlvbnNcIiBhcnJheS5cbiAqL1xuXG5mdW5jdGlvbiBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgcmVzb2x1dGlvbnMpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5yZXNvbHV0aW9ucyA9IHJlc29sdXRpb25zO1xuICB0aGlzLmN1cnJlbnRSZXNvbHV0aW9uID0gMDtcbiAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSBmYWxzZTtcbn1cblxuQ2FtUmVzb2x1dGlvbnNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbl0pO1xuICB9LFxuXG4gIHN0YXJ0R2V0VXNlck1lZGlhOiBmdW5jdGlvbihyZXNvbHV0aW9uKSB7XG4gICAgdmFyIGNvbnN0cmFpbnRzID0ge1xuICAgICAgYXVkaW86IGZhbHNlLFxuICAgICAgdmlkZW86IHtcbiAgICAgICAgd2lkdGg6IHtleGFjdDogcmVzb2x1dGlvblswXX0sXG4gICAgICAgIGhlaWdodDoge2V4YWN0OiByZXNvbHV0aW9uWzFdfVxuICAgICAgfVxuICAgIH07XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIC8vIERvIG5vdCBjaGVjayBhY3R1YWwgdmlkZW8gZnJhbWVzIHdoZW4gbW9yZSB0aGFuIG9uZSByZXNvbHV0aW9uIGlzXG4gICAgICAgICAgLy8gcHJvdmlkZWQuXG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1N1cHBvcnRlZDogJyArIHJlc29sdXRpb25bMF0gKyAneCcgK1xuICAgICAgICAgICAgcmVzb2x1dGlvblsxXSk7XG4gICAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMubWF5YmVDb250aW51ZUdldFVzZXJNZWRpYSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNvbGxlY3RBbmRBbmFseXplU3RhdHNfKHN0cmVhbSwgcmVzb2x1dGlvbik7XG4gICAgICAgICAgfVxuICAgICAgICB9LmJpbmQodGhpcykpXG4gICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKHJlc29sdXRpb25bMF0gKyAneCcgKyByZXNvbHV0aW9uWzFdICtcbiAgICAgICAgICAgICcgbm90IHN1cHBvcnRlZCcpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZGlyKGNvbnN0cmFpbnRzKTtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignZ2V0VXNlck1lZGlhIGZhaWxlZCB3aXRoIGVycm9yOiAnICtcbiAgICAgICAgICAgICAgICBlcnJvci5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgIH0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgbWF5YmVDb250aW51ZUdldFVzZXJNZWRpYTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY3VycmVudFJlc29sdXRpb24gPT09IHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbisrXSk7XG4gIH0sXG5cbiAgY29sbGVjdEFuZEFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHN0cmVhbSwgcmVzb2x1dGlvbikge1xuICAgIHZhciB0cmFja3MgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKTtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gdmlkZW8gdHJhY2sgaW4gcmV0dXJuZWQgc3RyZWFtLicpO1xuICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50IGhhbmRsZXJzIG9uIG1lZGlhU3RyZWFtVHJhY2sgeWV0LlxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9NZWRpYVN0cmVhbVRyYWNrXG4gICAgLy8gVE9ETzogcmVtb3ZlIGlmICguLi4pIHdoZW4gZXZlbnQgaGFuZGxlcnMgYXJlIHN1cHBvcnRlZCBieSBGaXJlZm94LlxuICAgIHZhciB2aWRlb1RyYWNrID0gdHJhY2tzWzBdO1xuICAgIGlmICh0eXBlb2YgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBSZWdpc3RlciBldmVudHMuXG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ2VuZGVkJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1ZpZGVvIHRyYWNrIGVuZGVkLCBjYW1lcmEgc3RvcHBlZCB3b3JraW5nJyk7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCdtdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIG11dGVkLicpO1xuICAgICAgICAvLyBNZWRpYVN0cmVhbVRyYWNrLm11dGVkIHByb3BlcnR5IGlzIG5vdCB3aXJlZCB1cCBpbiBDaHJvbWUgeWV0LFxuICAgICAgICAvLyBjaGVja2luZyBpc011dGVkIGxvY2FsIHN0YXRlLlxuICAgICAgICB0aGlzLmlzTXV0ZWQgPSB0cnVlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcigndW5tdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIHVubXV0ZWQuJyk7XG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICB2YXIgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2aWRlbycpO1xuICAgIHZpZGVvLnNldEF0dHJpYnV0ZSgnYXV0b3BsYXknLCAnJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdtdXRlZCcsICcnKTtcbiAgICB2aWRlby53aWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgdmlkZW8uaGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICB2aWRlby5zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgdmFyIGZyYW1lQ2hlY2tlciA9IG5ldyBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlbyk7XG4gICAgdmFyIGNhbGwgPSBuZXcgQ2FsbChudWxsLCB0aGlzLnRlc3QpO1xuICAgIGNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIGNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIGNhbGwuZ2F0aGVyU3RhdHMoY2FsbC5wYzEsIG51bGwsIHN0cmVhbSxcbiAgICAgICAgdGhpcy5vbkNhbGxFbmRlZF8uYmluZCh0aGlzLCByZXNvbHV0aW9uLCB2aWRlbyxcbiAgICAgICAgICAgIHN0cmVhbSwgZnJhbWVDaGVja2VyKSxcbiAgICAgICAgMTAwKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZW5kQ2FsbF8uYmluZCh0aGlzLCBjYWxsLCBzdHJlYW0pLCA4MDAwKTtcbiAgfSxcblxuICBvbkNhbGxFbmRlZF86IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHRoaXMuYW5hbHl6ZVN0YXRzXyhyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgICAgICBzdGF0cywgc3RhdHNUaW1lKTtcblxuICAgIGZyYW1lQ2hlY2tlci5zdG9wKCk7XG5cbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9LFxuXG4gIGFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLFxuICAgIGZyYW1lQ2hlY2tlciwgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHZhciBnb29nQXZnRW5jb2RlVGltZSA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlSW5wdXQgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQgPSBbXTtcbiAgICB2YXIgc3RhdHNSZXBvcnQgPSB7fTtcbiAgICB2YXIgZnJhbWVTdGF0cyA9IGZyYW1lQ2hlY2tlci5mcmFtZVN0YXRzO1xuXG4gICAgZm9yICh2YXIgaW5kZXggaW4gc3RhdHMpIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0byBvbmx5IGNhcHR1cmUgc3RhdHMgYWZ0ZXIgdGhlIGVuY29kZXIgaXMgc2V0dXAuXG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICBnb29nQXZnRW5jb2RlVGltZS5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0F2Z0VuY29kZU1zKSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlU2VudC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZVNlbnQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRzUmVwb3J0LmNhbWVyYU5hbWUgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXS5sYWJlbCB8fCBOYU47XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9XaWR0aCA9IHZpZGVvRWxlbWVudC52aWRlb1dpZHRoO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvSGVpZ2h0ID0gdmlkZW9FbGVtZW50LnZpZGVvSGVpZ2h0O1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeVdpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlIZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHN0YXRzUmVwb3J0LmVuY29kZVNldHVwVGltZU1zID1cbiAgICAgICAgdGhpcy5leHRyYWN0RW5jb2RlclNldHVwVGltZV8oc3RhdHMsIHN0YXRzVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnRW5jb2RlVGltZU1zID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5taW5FbmNvZGVUaW1lTXMgPSBhcnJheU1pbihnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWF4RW5jb2RlVGltZU1zID0gYXJyYXlNYXgoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0lucHV0RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWluSW5wdXRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heElucHV0RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5hdmdTZW50RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5taW5TZW50RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heFNlbnRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQuaXNNdXRlZCA9IHRoaXMuaXNNdXRlZDtcbiAgICBzdGF0c1JlcG9ydC50ZXN0ZWRGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5ibGFja0ZyYW1lcyA9IGZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuZnJvemVuRnJhbWVzID0gZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXM7XG5cbiAgICAvLyBUT0RPOiBBZGQgYSByZXBvcnRJbmZvKCkgZnVuY3Rpb24gd2l0aCBhIHRhYmxlIGZvcm1hdCB0byBkaXNwbGF5XG4gICAgLy8gdmFsdWVzIGNsZWFyZXIuXG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd2aWRlby1zdGF0cycsIHN0YXRzUmVwb3J0KTtcblxuICAgIHRoaXMudGVzdEV4cGVjdGF0aW9uc18oc3RhdHNSZXBvcnQpO1xuICB9LFxuXG4gIGVuZENhbGxfOiBmdW5jdGlvbihjYWxsT2JqZWN0LCBzdHJlYW0pIHtcbiAgICB0aGlzLmlzU2h1dHRpbmdEb3duID0gdHJ1ZTtcbiAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIGNhbGxPYmplY3QuY2xvc2UoKTtcbiAgfSxcblxuICBleHRyYWN0RW5jb2RlclNldHVwVGltZV86IGZ1bmN0aW9uKHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4ICE9PSBzdGF0cy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc3RhdHNUaW1lW2luZGV4XSAtIHN0YXRzVGltZVswXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIE5hTjtcbiAgfSxcblxuICByZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF86IGZ1bmN0aW9uKGFXaWR0aCwgYUhlaWdodCxcbiAgICBiV2lkdGgsIGJIZWlnaHQpIHtcbiAgICB2YXIgbWluUmVzID0gTWF0aC5taW4oYldpZHRoLCBiSGVpZ2h0KTtcbiAgICByZXR1cm4gKGFXaWR0aCA9PT0gYldpZHRoICYmIGFIZWlnaHQgPT09IGJIZWlnaHQpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IGJIZWlnaHQgJiYgYUhlaWdodCA9PT0gYldpZHRoKSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBtaW5SZXMgJiYgYkhlaWdodCA9PT0gbWluUmVzKTtcbiAgfSxcblxuICB0ZXN0RXhwZWN0YXRpb25zXzogZnVuY3Rpb24oaW5mbykge1xuICAgIHZhciBub3RBdmFpbGFibGVTdGF0cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBpbmZvKSB7XG4gICAgICBpZiAoaW5mby5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaW5mb1trZXldID09PSAnbnVtYmVyJyAmJiBpc05hTihpbmZvW2tleV0pKSB7XG4gICAgICAgICAgbm90QXZhaWxhYmxlU3RhdHMucHVzaChrZXkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKGtleSArICc6ICcgKyBpbmZvW2tleV0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChub3RBdmFpbGFibGVTdGF0cy5sZW5ndGggIT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOb3QgYXZhaWxhYmxlOiAnICsgbm90QXZhaWxhYmxlU3RhdHMuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKGlzTmFOKGluZm8uYXZnU2VudEZwcykpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdDYW5ub3QgdmVyaWZ5IHNlbnQgRlBTLicpO1xuICAgIH0gZWxzZSBpZiAoaW5mby5hdmdTZW50RnBzIDwgNSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdMb3cgYXZlcmFnZSBzZW50IEZQUzogJyArIGluZm8uYXZnU2VudEZwcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBdmVyYWdlIEZQUyBhYm92ZSB0aHJlc2hvbGQnKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXyhcbiAgICAgICAgaW5mby5hY3R1YWxWaWRlb1dpZHRoLCBpbmZvLmFjdHVhbFZpZGVvSGVpZ2h0LCBpbmZvLm1hbmRhdG9yeVdpZHRoLFxuICAgICAgICBpbmZvLm1hbmRhdG9yeUhlaWdodCkpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignSW5jb3JyZWN0IGNhcHR1cmVkIHJlc29sdXRpb24uJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdDYXB0dXJlZCB2aWRlbyB1c2luZyBleHBlY3RlZCByZXNvbHV0aW9uLicpO1xuICAgIH1cbiAgICBpZiAoaW5mby50ZXN0ZWRGcmFtZXMgPT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGFuYWx5emUgYW55IHZpZGVvIGZyYW1lLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoaW5mby5ibGFja0ZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgYmxhY2sgZnJhbWVzLicpO1xuICAgICAgfVxuICAgICAgaWYgKGluZm8uZnJvemVuRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBmcm96ZW4gZnJhbWVzLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FtUmVzb2x1dGlvbnNUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFZpZGVvRnJhbWVDaGVja2VyIGZyb20gJy4uL3V0aWwvVmlkZW9GcmFtZUNoZWNrZXIuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi4vdXRpbC9yZXBvcnQuanMnO1xuaW1wb3J0IHsgYXJyYXlBdmVyYWdlLCBhcnJheU1pbiwgYXJyYXlNYXggfSBmcm9tICcuLi91dGlsL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG4vKlxuICogSW4gZ2VuZXJpYyBjYW1lcmFzIHVzaW5nIENocm9tZSByZXNjYWxlciwgYWxsIHJlc29sdXRpb25zIHNob3VsZCBiZSBzdXBwb3J0ZWRcbiAqIHVwIHRvIGEgZ2l2ZW4gb25lIGFuZCBub25lIGJleW9uZCB0aGVyZS4gU3BlY2lhbCBjYW1lcmFzLCBzdWNoIGFzIGRpZ2l0aXplcnMsXG4gKiBtaWdodCBzdXBwb3J0IG9ubHkgb25lIHJlc29sdXRpb24uXG4gKi9cblxuLypcbiAqIFwiQW5hbHl6ZSBwZXJmb3JtYW5jZSBmb3IgXCJyZXNvbHV0aW9uXCJcIiB0ZXN0IHVzZXMgZ2V0U3RhdHMsIGNhbnZhcyBhbmQgdGhlXG4gKiB2aWRlbyBlbGVtZW50IHRvIGFuYWx5emUgdGhlIHZpZGVvIGZyYW1lcyBmcm9tIGEgY2FwdHVyZSBkZXZpY2UuIEl0IHdpbGxcbiAqIHJlcG9ydCBudW1iZXIgb2YgYmxhY2sgZnJhbWVzLCBmcm96ZW4gZnJhbWVzLCB0ZXN0ZWQgZnJhbWVzIGFuZCB2YXJpb3VzIHN0YXRzXG4gKiBsaWtlIGF2ZXJhZ2UgZW5jb2RlIHRpbWUgYW5kIEZQUy4gQSB0ZXN0IGNhc2Ugd2lsbCBiZSBjcmVhdGVkIHBlciBtYW5kYXRvcnlcbiAqIHJlc29sdXRpb24gZm91bmQgaW4gdGhlIFwicmVzb2x1dGlvbnNcIiBhcnJheS5cbiAqL1xuXG5mdW5jdGlvbiBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgcmVzb2x1dGlvbnMpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5yZXNvbHV0aW9ucyA9IHJlc29sdXRpb25zO1xuICB0aGlzLmN1cnJlbnRSZXNvbHV0aW9uID0gMDtcbiAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSBmYWxzZTtcbn1cblxuQ2FtUmVzb2x1dGlvbnNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbl0pO1xuICB9LFxuXG4gIHN0YXJ0R2V0VXNlck1lZGlhOiBmdW5jdGlvbihyZXNvbHV0aW9uKSB7XG4gICAgdmFyIGNvbnN0cmFpbnRzID0ge1xuICAgICAgYXVkaW86IGZhbHNlLFxuICAgICAgdmlkZW86IHtcbiAgICAgICAgd2lkdGg6IHtleGFjdDogcmVzb2x1dGlvblswXX0sXG4gICAgICAgIGhlaWdodDoge2V4YWN0OiByZXNvbHV0aW9uWzFdfVxuICAgICAgfVxuICAgIH07XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIC8vIERvIG5vdCBjaGVjayBhY3R1YWwgdmlkZW8gZnJhbWVzIHdoZW4gbW9yZSB0aGFuIG9uZSByZXNvbHV0aW9uIGlzXG4gICAgICAgICAgLy8gcHJvdmlkZWQuXG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1N1cHBvcnRlZDogJyArIHJlc29sdXRpb25bMF0gKyAneCcgK1xuICAgICAgICAgICAgcmVzb2x1dGlvblsxXSk7XG4gICAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMubWF5YmVDb250aW51ZUdldFVzZXJNZWRpYSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNvbGxlY3RBbmRBbmFseXplU3RhdHNfKHN0cmVhbSwgcmVzb2x1dGlvbik7XG4gICAgICAgICAgfVxuICAgICAgICB9LmJpbmQodGhpcykpXG4gICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKHJlc29sdXRpb25bMF0gKyAneCcgKyByZXNvbHV0aW9uWzFdICtcbiAgICAgICAgICAgICcgbm90IHN1cHBvcnRlZCcpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZGlyKGNvbnN0cmFpbnRzKTtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignZ2V0VXNlck1lZGlhIGZhaWxlZCB3aXRoIGVycm9yOiAnICtcbiAgICAgICAgICAgICAgICBlcnJvci5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgIH0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgbWF5YmVDb250aW51ZUdldFVzZXJNZWRpYTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY3VycmVudFJlc29sdXRpb24gPT09IHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbisrXSk7XG4gIH0sXG5cbiAgY29sbGVjdEFuZEFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHN0cmVhbSwgcmVzb2x1dGlvbikge1xuICAgIHZhciB0cmFja3MgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKTtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gdmlkZW8gdHJhY2sgaW4gcmV0dXJuZWQgc3RyZWFtLicpO1xuICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50IGhhbmRsZXJzIG9uIG1lZGlhU3RyZWFtVHJhY2sgeWV0LlxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9NZWRpYVN0cmVhbVRyYWNrXG4gICAgLy8gVE9ETzogcmVtb3ZlIGlmICguLi4pIHdoZW4gZXZlbnQgaGFuZGxlcnMgYXJlIHN1cHBvcnRlZCBieSBGaXJlZm94LlxuICAgIHZhciB2aWRlb1RyYWNrID0gdHJhY2tzWzBdO1xuICAgIGlmICh0eXBlb2YgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBSZWdpc3RlciBldmVudHMuXG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ2VuZGVkJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1ZpZGVvIHRyYWNrIGVuZGVkLCBjYW1lcmEgc3RvcHBlZCB3b3JraW5nJyk7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCdtdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIG11dGVkLicpO1xuICAgICAgICAvLyBNZWRpYVN0cmVhbVRyYWNrLm11dGVkIHByb3BlcnR5IGlzIG5vdCB3aXJlZCB1cCBpbiBDaHJvbWUgeWV0LFxuICAgICAgICAvLyBjaGVja2luZyBpc011dGVkIGxvY2FsIHN0YXRlLlxuICAgICAgICB0aGlzLmlzTXV0ZWQgPSB0cnVlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcigndW5tdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIHVubXV0ZWQuJyk7XG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICB2YXIgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2aWRlbycpO1xuICAgIHZpZGVvLnNldEF0dHJpYnV0ZSgnYXV0b3BsYXknLCAnJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdtdXRlZCcsICcnKTtcbiAgICB2aWRlby53aWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgdmlkZW8uaGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICB2aWRlby5zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgdmFyIGZyYW1lQ2hlY2tlciA9IG5ldyBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlbyk7XG4gICAgdmFyIGNhbGwgPSBuZXcgQ2FsbChudWxsLCB0aGlzLnRlc3QpO1xuICAgIGNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIGNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIGNhbGwuZ2F0aGVyU3RhdHMoY2FsbC5wYzEsIG51bGwsIHN0cmVhbSxcbiAgICAgICAgdGhpcy5vbkNhbGxFbmRlZF8uYmluZCh0aGlzLCByZXNvbHV0aW9uLCB2aWRlbyxcbiAgICAgICAgICAgIHN0cmVhbSwgZnJhbWVDaGVja2VyKSxcbiAgICAgICAgMTAwKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZW5kQ2FsbF8uYmluZCh0aGlzLCBjYWxsLCBzdHJlYW0pLCA4MDAwKTtcbiAgfSxcblxuICBvbkNhbGxFbmRlZF86IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHRoaXMuYW5hbHl6ZVN0YXRzXyhyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgICAgICBzdGF0cywgc3RhdHNUaW1lKTtcblxuICAgIGZyYW1lQ2hlY2tlci5zdG9wKCk7XG5cbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9LFxuXG4gIGFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLFxuICAgIGZyYW1lQ2hlY2tlciwgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHZhciBnb29nQXZnRW5jb2RlVGltZSA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlSW5wdXQgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQgPSBbXTtcbiAgICB2YXIgc3RhdHNSZXBvcnQgPSB7fTtcbiAgICB2YXIgZnJhbWVTdGF0cyA9IGZyYW1lQ2hlY2tlci5mcmFtZVN0YXRzO1xuXG4gICAgZm9yICh2YXIgaW5kZXggaW4gc3RhdHMpIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0byBvbmx5IGNhcHR1cmUgc3RhdHMgYWZ0ZXIgdGhlIGVuY29kZXIgaXMgc2V0dXAuXG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICBnb29nQXZnRW5jb2RlVGltZS5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0F2Z0VuY29kZU1zKSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlU2VudC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZVNlbnQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRzUmVwb3J0LmNhbWVyYU5hbWUgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXS5sYWJlbCB8fCBOYU47XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9XaWR0aCA9IHZpZGVvRWxlbWVudC52aWRlb1dpZHRoO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvSGVpZ2h0ID0gdmlkZW9FbGVtZW50LnZpZGVvSGVpZ2h0O1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeVdpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlIZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHN0YXRzUmVwb3J0LmVuY29kZVNldHVwVGltZU1zID1cbiAgICAgICAgdGhpcy5leHRyYWN0RW5jb2RlclNldHVwVGltZV8oc3RhdHMsIHN0YXRzVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnRW5jb2RlVGltZU1zID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5taW5FbmNvZGVUaW1lTXMgPSBhcnJheU1pbihnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWF4RW5jb2RlVGltZU1zID0gYXJyYXlNYXgoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0lucHV0RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWluSW5wdXRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heElucHV0RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5hdmdTZW50RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5taW5TZW50RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heFNlbnRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQuaXNNdXRlZCA9IHRoaXMuaXNNdXRlZDtcbiAgICBzdGF0c1JlcG9ydC50ZXN0ZWRGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5ibGFja0ZyYW1lcyA9IGZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuZnJvemVuRnJhbWVzID0gZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXM7XG5cbiAgICAvLyBUT0RPOiBBZGQgYSByZXBvcnRJbmZvKCkgZnVuY3Rpb24gd2l0aCBhIHRhYmxlIGZvcm1hdCB0byBkaXNwbGF5XG4gICAgLy8gdmFsdWVzIGNsZWFyZXIuXG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd2aWRlby1zdGF0cycsIHN0YXRzUmVwb3J0KTtcblxuICAgIHRoaXMudGVzdEV4cGVjdGF0aW9uc18oc3RhdHNSZXBvcnQpO1xuICB9LFxuXG4gIGVuZENhbGxfOiBmdW5jdGlvbihjYWxsT2JqZWN0LCBzdHJlYW0pIHtcbiAgICB0aGlzLmlzU2h1dHRpbmdEb3duID0gdHJ1ZTtcbiAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIGNhbGxPYmplY3QuY2xvc2UoKTtcbiAgfSxcblxuICBleHRyYWN0RW5jb2RlclNldHVwVGltZV86IGZ1bmN0aW9uKHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4ICE9PSBzdGF0cy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc3RhdHNUaW1lW2luZGV4XSAtIHN0YXRzVGltZVswXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIE5hTjtcbiAgfSxcblxuICByZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF86IGZ1bmN0aW9uKGFXaWR0aCwgYUhlaWdodCxcbiAgICBiV2lkdGgsIGJIZWlnaHQpIHtcbiAgICB2YXIgbWluUmVzID0gTWF0aC5taW4oYldpZHRoLCBiSGVpZ2h0KTtcbiAgICByZXR1cm4gKGFXaWR0aCA9PT0gYldpZHRoICYmIGFIZWlnaHQgPT09IGJIZWlnaHQpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IGJIZWlnaHQgJiYgYUhlaWdodCA9PT0gYldpZHRoKSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBtaW5SZXMgJiYgYkhlaWdodCA9PT0gbWluUmVzKTtcbiAgfSxcblxuICB0ZXN0RXhwZWN0YXRpb25zXzogZnVuY3Rpb24oaW5mbykge1xuICAgIHZhciBub3RBdmFpbGFibGVTdGF0cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBpbmZvKSB7XG4gICAgICBpZiAoaW5mby5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaW5mb1trZXldID09PSAnbnVtYmVyJyAmJiBpc05hTihpbmZvW2tleV0pKSB7XG4gICAgICAgICAgbm90QXZhaWxhYmxlU3RhdHMucHVzaChrZXkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKGtleSArICc6ICcgKyBpbmZvW2tleV0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChub3RBdmFpbGFibGVTdGF0cy5sZW5ndGggIT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOb3QgYXZhaWxhYmxlOiAnICsgbm90QXZhaWxhYmxlU3RhdHMuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKGlzTmFOKGluZm8uYXZnU2VudEZwcykpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdDYW5ub3QgdmVyaWZ5IHNlbnQgRlBTLicpO1xuICAgIH0gZWxzZSBpZiAoaW5mby5hdmdTZW50RnBzIDwgNSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdMb3cgYXZlcmFnZSBzZW50IEZQUzogJyArIGluZm8uYXZnU2VudEZwcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBdmVyYWdlIEZQUyBhYm92ZSB0aHJlc2hvbGQnKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXyhcbiAgICAgICAgaW5mby5hY3R1YWxWaWRlb1dpZHRoLCBpbmZvLmFjdHVhbFZpZGVvSGVpZ2h0LCBpbmZvLm1hbmRhdG9yeVdpZHRoLFxuICAgICAgICBpbmZvLm1hbmRhdG9yeUhlaWdodCkpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignSW5jb3JyZWN0IGNhcHR1cmVkIHJlc29sdXRpb24uJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdDYXB0dXJlZCB2aWRlbyB1c2luZyBleHBlY3RlZCByZXNvbHV0aW9uLicpO1xuICAgIH1cbiAgICBpZiAoaW5mby50ZXN0ZWRGcmFtZXMgPT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGFuYWx5emUgYW55IHZpZGVvIGZyYW1lLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoaW5mby5ibGFja0ZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgYmxhY2sgZnJhbWVzLicpO1xuICAgICAgfVxuICAgICAgaWYgKGluZm8uZnJvemVuRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBmcm96ZW4gZnJhbWVzLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FtUmVzb2x1dGlvbnNUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcblxuZnVuY3Rpb24gUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGltZW91dCA9IG51bGw7XG4gIHRoaXMucGFyc2VkQ2FuZGlkYXRlcyA9IFtdO1xuICB0aGlzLmNhbGwgPSBudWxsO1xufVxuXG5SdW5Db25uZWN0aXZpdHlUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksXG4gICAgICAgIHRoaXMudGVzdCk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcblxuICAgIC8vIENvbGxlY3QgYWxsIGNhbmRpZGF0ZXMgZm9yIHZhbGlkYXRpb24uXG4gICAgdGhpcy5jYWxsLnBjMS5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgaWYgKGV2ZW50LmNhbmRpZGF0ZSkge1xuICAgICAgICB2YXIgcGFyc2VkQ2FuZGlkYXRlID0gQ2FsbC5wYXJzZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlKTtcbiAgICAgICAgdGhpcy5wYXJzZWRDYW5kaWRhdGVzLnB1c2gocGFyc2VkQ2FuZGlkYXRlKTtcblxuICAgICAgICAvLyBSZXBvcnQgY2FuZGlkYXRlIGluZm8gYmFzZWQgb24gaWNlQ2FuZGlkYXRlRmlsdGVyLlxuICAgICAgICBpZiAodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIocGFyc2VkQ2FuZGlkYXRlKSkge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKFxuICAgICAgICAgICAgICAnR2F0aGVyZWQgY2FuZGlkYXRlIG9mIFR5cGU6ICcgKyBwYXJzZWRDYW5kaWRhdGUudHlwZSArXG4gICAgICAgICAgICAnIFByb3RvY29sOiAnICsgcGFyc2VkQ2FuZGlkYXRlLnByb3RvY29sICtcbiAgICAgICAgICAgICcgQWRkcmVzczogJyArIHBhcnNlZENhbmRpZGF0ZS5hZGRyZXNzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSk7XG5cbiAgICB2YXIgY2gxID0gdGhpcy5jYWxsLnBjMS5jcmVhdGVEYXRhQ2hhbm5lbChudWxsKTtcbiAgICBjaDEuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsIGZ1bmN0aW9uKCkge1xuICAgICAgY2gxLnNlbmQoJ2hlbGxvJyk7XG4gICAgfSk7XG4gICAgY2gxLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgaWYgKGV2ZW50LmRhdGEgIT09ICd3b3JsZCcpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdJbnZhbGlkIGRhdGEgdHJhbnNtaXR0ZWQuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnRGF0YSBzdWNjZXNzZnVsbHkgdHJhbnNtaXR0ZWQgYmV0d2VlbiBwZWVycy4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaGFuZ3VwKCk7XG4gICAgfS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwucGMyLmFkZEV2ZW50TGlzdGVuZXIoJ2RhdGFjaGFubmVsJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIHZhciBjaDIgPSBldmVudC5jaGFubmVsO1xuICAgICAgY2gyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAoZXZlbnQuZGF0YSAhPT0gJ2hlbGxvJykge1xuICAgICAgICAgIHRoaXMuaGFuZ3VwKCdJbnZhbGlkIGRhdGEgdHJhbnNtaXR0ZWQuJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2gyLnNlbmQoJ3dvcmxkJyk7XG4gICAgICAgIH1cbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgfS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIHRoaXMudGltZW91dCA9IHNldFRpbWVvdXQodGhpcy5oYW5ndXAuYmluZCh0aGlzLCAnVGltZWQgb3V0JyksIDUwMDApO1xuICB9LFxuXG4gIGZpbmRQYXJzZWRDYW5kaWRhdGVPZlNwZWNpZmllZFR5cGU6IGZ1bmN0aW9uKGNhbmRpZGF0ZVR5cGVNZXRob2QpIHtcbiAgICBmb3IgKHZhciBjYW5kaWRhdGUgaW4gdGhpcy5wYXJzZWRDYW5kaWRhdGVzKSB7XG4gICAgICBpZiAoY2FuZGlkYXRlVHlwZU1ldGhvZCh0aGlzLnBhcnNlZENhbmRpZGF0ZXNbY2FuZGlkYXRlXSkpIHtcbiAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZVR5cGVNZXRob2QodGhpcy5wYXJzZWRDYW5kaWRhdGVzW2NhbmRpZGF0ZV0pO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBoYW5ndXA6IGZ1bmN0aW9uKGVycm9yTWVzc2FnZSkge1xuICAgIGlmIChlcnJvck1lc3NhZ2UpIHtcbiAgICAgIC8vIFJlcG9ydCB3YXJuaW5nIGZvciBzZXJ2ZXIgcmVmbGV4aXZlIHRlc3QgaWYgaXQgdGltZXMgb3V0LlxuICAgICAgaWYgKGVycm9yTWVzc2FnZSA9PT0gJ1RpbWVkIG91dCcgJiZcbiAgICAgICAgICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlci50b1N0cmluZygpID09PSBDYWxsLmlzUmVmbGV4aXZlLnRvU3RyaW5nKCkgJiZcbiAgICAgICAgICB0aGlzLmZpbmRQYXJzZWRDYW5kaWRhdGVPZlNwZWNpZmllZFR5cGUoQ2FsbC5pc1JlZmxleGl2ZSkpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0NvdWxkIG5vdCBjb25uZWN0IHVzaW5nIHJlZmxleGl2ZSAnICtcbiAgICAgICAgICAgICdjYW5kaWRhdGVzLCBsaWtlbHkgZHVlIHRvIHRoZSBuZXR3b3JrIGVudmlyb25tZW50L2NvbmZpZ3VyYXRpb24uJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dCk7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgUnVuQ29ubmVjdGl2aXR5VGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvQ2FsbC5qcyc7XG5cbmZ1bmN0aW9uIERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMgPSA1LjA7XG4gIHRoaXMuc3RhcnRUaW1lID0gbnVsbDtcbiAgdGhpcy5zZW50UGF5bG9hZEJ5dGVzID0gMDtcbiAgdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyA9IDA7XG4gIHRoaXMuc3RvcFNlbmRpbmcgPSBmYWxzZTtcbiAgdGhpcy5zYW1wbGVQYWNrZXQgPSAnJztcblxuICBmb3IgKHZhciBpID0gMDsgaSAhPT0gMTAyNDsgKytpKSB7XG4gICAgdGhpcy5zYW1wbGVQYWNrZXQgKz0gJ2gnO1xuICB9XG5cbiAgdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQgPSAxO1xuICB0aGlzLmJ5dGVzVG9LZWVwQnVmZmVyZWQgPSAxMDI0ICogdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQ7XG4gIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA9IG51bGw7XG4gIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzID0gMDtcblxuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpLCB0aGlzLnRlc3QpO1xuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLmNhbGwgPSBuZXcgQ2FsbChjb25maWcsIHRoaXMudGVzdCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcihDYWxsLmlzUmVsYXkpO1xuICAgIHRoaXMuc2VuZGVyQ2hhbm5lbCA9IHRoaXMuY2FsbC5wYzEuY3JlYXRlRGF0YUNoYW5uZWwobnVsbCk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLnNlbmRpbmdTdGVwLmJpbmQodGhpcykpO1xuXG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsXG4gICAgICAgIHRoaXMub25SZWNlaXZlckNoYW5uZWwuYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICB9LFxuXG4gIG9uUmVjZWl2ZXJDaGFubmVsOiBmdW5jdGlvbihldmVudCkge1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBldmVudC5jaGFubmVsO1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsXG4gICAgICAgIHRoaXMub25NZXNzYWdlUmVjZWl2ZWQuYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgc2VuZGluZ1N0ZXA6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGlmICghdGhpcy5zdGFydFRpbWUpIHtcbiAgICAgIHRoaXMuc3RhcnRUaW1lID0gbm93O1xuICAgICAgdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID0gbm93O1xuICAgIH1cblxuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSB0aGlzLm1heE51bWJlck9mUGFja2V0c1RvU2VuZDsgKytpKSB7XG4gICAgICBpZiAodGhpcy5zZW5kZXJDaGFubmVsLmJ1ZmZlcmVkQW1vdW50ID49IHRoaXMuYnl0ZXNUb0tlZXBCdWZmZXJlZCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRoaXMuc2VudFBheWxvYWRCeXRlcyArPSB0aGlzLnNhbXBsZVBhY2tldC5sZW5ndGg7XG4gICAgICB0aGlzLnNlbmRlckNoYW5uZWwuc2VuZCh0aGlzLnNhbXBsZVBhY2tldCk7XG4gICAgfVxuXG4gICAgaWYgKG5vdyAtIHRoaXMuc3RhcnRUaW1lID49IDEwMDAgKiB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMpIHtcbiAgICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygxMDApO1xuICAgICAgdGhpcy5zdG9wU2VuZGluZyA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygobm93IC0gdGhpcy5zdGFydFRpbWUpIC9cbiAgICAgICAgICAoMTAgKiB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMpKTtcbiAgICAgIHNldFRpbWVvdXQodGhpcy5zZW5kaW5nU3RlcC5iaW5kKHRoaXMpLCAxKTtcbiAgICB9XG4gIH0sXG5cbiAgb25NZXNzYWdlUmVjZWl2ZWQ6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyArPSBldmVudC5kYXRhLmxlbmd0aDtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBpZiAobm93IC0gdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID49IDEwMDApIHtcbiAgICAgIHZhciBiaXRyYXRlID0gKHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMgLVxuICAgICAgICAgIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzKSAvIChub3cgLSB0aGlzLmxhc3RCaXRyYXRlTWVhc3VyZVRpbWUpO1xuICAgICAgYml0cmF0ZSA9IE1hdGgucm91bmQoYml0cmF0ZSAqIDEwMDAgKiA4KSAvIDEwMDA7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnVHJhbnNtaXR0aW5nIGF0ICcgKyBiaXRyYXRlICsgJyBrYnBzLicpO1xuICAgICAgdGhpcy5sYXN0UmVjZWl2ZWRQYXlsb2FkQnl0ZXMgPSB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzO1xuICAgICAgdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID0gbm93O1xuICAgIH1cbiAgICBpZiAodGhpcy5zdG9wU2VuZGluZyAmJlxuICAgICAgICB0aGlzLnNlbnRQYXlsb2FkQnl0ZXMgPT09IHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMpIHtcbiAgICAgIHRoaXMuY2FsbC5jbG9zZSgpO1xuICAgICAgdGhpcy5jYWxsID0gbnVsbDtcblxuICAgICAgdmFyIGVsYXBzZWRUaW1lID0gTWF0aC5yb3VuZCgobm93IC0gdGhpcy5zdGFydFRpbWUpICogMTApIC8gMTAwMDAuMDtcbiAgICAgIHZhciByZWNlaXZlZEtCaXRzID0gdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyAqIDggLyAxMDAwO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1RvdGFsIHRyYW5zbWl0dGVkOiAnICsgcmVjZWl2ZWRLQml0cyArXG4gICAgICAgICAgJyBraWxvLWJpdHMgaW4gJyArIGVsYXBzZWRUaW1lICsgJyBzZWNvbmRzLicpO1xuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIE1pY1Rlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLmlucHV0Q2hhbm5lbENvdW50ID0gNjtcbiAgdGhpcy5vdXRwdXRDaGFubmVsQ291bnQgPSAyO1xuICAvLyBCdWZmZXIgc2l6ZSBzZXQgdG8gMCB0byBsZXQgQ2hyb21lIGNob29zZSBiYXNlZCBvbiB0aGUgcGxhdGZvcm0uXG4gIHRoaXMuYnVmZmVyU2l6ZSA9IDA7XG4gIC8vIFR1cm5pbmcgb2ZmIGVjaG9DYW5jZWxsYXRpb24gY29uc3RyYWludCBlbmFibGVzIHN0ZXJlbyBpbnB1dC5cbiAgdGhpcy5jb25zdHJhaW50cyA9IHtcbiAgICBhdWRpbzoge1xuICAgICAgb3B0aW9uYWw6IFtcbiAgICAgICAge2VjaG9DYW5jZWxsYXRpb246IGZhbHNlfVxuICAgICAgXVxuICAgIH1cbiAgfTtcblxuICB0aGlzLmNvbGxlY3RTZWNvbmRzID0gMi4wO1xuICAvLyBBdCBsZWFzdCBvbmUgTFNCIDE2LWJpdCBkYXRhIChjb21wYXJlIGlzIG9uIGFic29sdXRlIHZhbHVlKS5cbiAgdGhpcy5zaWxlbnRUaHJlc2hvbGQgPSAxLjAgLyAzMjc2NztcbiAgdGhpcy5sb3dWb2x1bWVUaHJlc2hvbGQgPSAtNjA7XG4gIC8vIERhdGEgbXVzdCBiZSBpZGVudGljYWwgd2l0aGluIG9uZSBMU0IgMTYtYml0IHRvIGJlIGlkZW50aWZpZWQgYXMgbW9uby5cbiAgdGhpcy5tb25vRGV0ZWN0VGhyZXNob2xkID0gMS4wIC8gNjU1MzY7XG4gIC8vIE51bWJlciBvZiBjb25zZXF1dGl2ZSBjbGlwVGhyZXNob2xkIGxldmVsIHNhbXBsZXMgdGhhdCBpbmRpY2F0ZSBjbGlwcGluZy5cbiAgdGhpcy5jbGlwQ291bnRUaHJlc2hvbGQgPSA2O1xuICB0aGlzLmNsaXBUaHJlc2hvbGQgPSAxLjA7XG5cbiAgLy8gUG9wdWxhdGVkIHdpdGggYXVkaW8gYXMgYSAzLWRpbWVuc2lvbmFsIGFycmF5OlxuICAvLyAgIGNvbGxlY3RlZEF1ZGlvW2NoYW5uZWxzXVtidWZmZXJzXVtzYW1wbGVzXVxuICB0aGlzLmNvbGxlY3RlZEF1ZGlvID0gW107XG4gIHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaW5wdXRDaGFubmVsQ291bnQ7ICsraSkge1xuICAgIHRoaXMuY29sbGVjdGVkQXVkaW9baV0gPSBbXTtcbiAgfVxuICB0cnkge1xuICAgIHdpbmRvdy5BdWRpb0NvbnRleHQgPSB3aW5kb3cuQXVkaW9Db250ZXh0IHx8IHdpbmRvdy53ZWJraXRBdWRpb0NvbnRleHQ7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBuZXcgQXVkaW9Db250ZXh0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgYW4gYXVkaW8gY29udGV4dCwgZXJyb3I6ICcgKyBlKTtcbiAgfVxufVxuXG5NaWNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuYXVkaW9Db250ZXh0ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdXZWJBdWRpbyBpcyBub3Qgc3VwcG9ydGVkLCB0ZXN0IGNhbm5vdCBydW4uJyk7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QuZG9HZXRVc2VyTWVkaWEodGhpcy5jb25zdHJhaW50cywgdGhpcy5nb3RTdHJlYW0uYmluZCh0aGlzKSk7XG4gICAgfVxuICB9LFxuXG4gIGdvdFN0cmVhbTogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgaWYgKCF0aGlzLmNoZWNrQXVkaW9UcmFja3Moc3RyZWFtKSkge1xuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVBdWRpb0J1ZmZlcihzdHJlYW0pO1xuICB9LFxuXG4gIGNoZWNrQXVkaW9UcmFja3M6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtO1xuICAgIHZhciBhdWRpb1RyYWNrcyA9IHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpO1xuICAgIGlmIChhdWRpb1RyYWNrcy5sZW5ndGggPCAxKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ05vIGF1ZGlvIHRyYWNrIGluIHJldHVybmVkIHN0cmVhbS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0F1ZGlvIHRyYWNrIGNyZWF0ZWQgdXNpbmcgZGV2aWNlPScgK1xuICAgICAgICBhdWRpb1RyYWNrc1swXS5sYWJlbCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgY3JlYXRlQXVkaW9CdWZmZXI6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYXVkaW9Tb3VyY2UgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVNZWRpYVN0cmVhbVNvdXJjZSh0aGlzLnN0cmVhbSk7XG4gICAgdGhpcy5zY3JpcHROb2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlU2NyaXB0UHJvY2Vzc29yKHRoaXMuYnVmZmVyU2l6ZSxcbiAgICAgICAgdGhpcy5pbnB1dENoYW5uZWxDb3VudCwgdGhpcy5vdXRwdXRDaGFubmVsQ291bnQpO1xuICAgIHRoaXMuYXVkaW9Tb3VyY2UuY29ubmVjdCh0aGlzLnNjcmlwdE5vZGUpO1xuICAgIHRoaXMuc2NyaXB0Tm9kZS5jb25uZWN0KHRoaXMuYXVkaW9Db250ZXh0LmRlc3RpbmF0aW9uKTtcbiAgICB0aGlzLnNjcmlwdE5vZGUub25hdWRpb3Byb2Nlc3MgPSB0aGlzLmNvbGxlY3RBdWRpby5iaW5kKHRoaXMpO1xuICAgIHRoaXMuc3RvcENvbGxlY3RpbmdBdWRpbyA9IHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKFxuICAgICAgICB0aGlzLm9uU3RvcENvbGxlY3RpbmdBdWRpby5iaW5kKHRoaXMpLCA1MDAwKTtcbiAgfSxcblxuICBjb2xsZWN0QXVkaW86IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgLy8gU2ltcGxlIHNpbGVuY2UgZGV0ZWN0aW9uOiBjaGVjayBmaXJzdCBhbmQgbGFzdCBzYW1wbGUgb2YgZWFjaCBjaGFubmVsIGluXG4gICAgLy8gdGhlIGJ1ZmZlci4gSWYgYm90aCBhcmUgYmVsb3cgYSB0aHJlc2hvbGQsIHRoZSBidWZmZXIgaXMgY29uc2lkZXJlZFxuICAgIC8vIHNpbGVudC5cbiAgICB2YXIgc2FtcGxlQ291bnQgPSBldmVudC5pbnB1dEJ1ZmZlci5sZW5ndGg7XG4gICAgdmFyIGFsbFNpbGVudCA9IHRydWU7XG4gICAgZm9yICh2YXIgYyA9IDA7IGMgPCBldmVudC5pbnB1dEJ1ZmZlci5udW1iZXJPZkNoYW5uZWxzOyBjKyspIHtcbiAgICAgIHZhciBkYXRhID0gZXZlbnQuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoYyk7XG4gICAgICB2YXIgZmlyc3QgPSBNYXRoLmFicyhkYXRhWzBdKTtcbiAgICAgIHZhciBsYXN0ID0gTWF0aC5hYnMoZGF0YVtzYW1wbGVDb3VudCAtIDFdKTtcbiAgICAgIHZhciBuZXdCdWZmZXI7XG4gICAgICBpZiAoZmlyc3QgPiB0aGlzLnNpbGVudFRocmVzaG9sZCB8fCBsYXN0ID4gdGhpcy5zaWxlbnRUaHJlc2hvbGQpIHtcbiAgICAgICAgLy8gTm9uLXNpbGVudCBidWZmZXJzIGFyZSBjb3BpZWQgZm9yIGFuYWx5c2lzLiBOb3RlIHRoYXQgdGhlIHNpbGVudFxuICAgICAgICAvLyBkZXRlY3Rpb24gd2lsbCBsaWtlbHkgY2F1c2UgdGhlIHN0b3JlZCBzdHJlYW0gdG8gY29udGFpbiBkaXNjb250aW51LVxuICAgICAgICAvLyBpdGllcywgYnV0IHRoYXQgaXMgb2sgZm9yIG91ciBuZWVkcyBoZXJlIChqdXN0IGxvb2tpbmcgYXQgbGV2ZWxzKS5cbiAgICAgICAgbmV3QnVmZmVyID0gbmV3IEZsb2F0MzJBcnJheShzYW1wbGVDb3VudCk7XG4gICAgICAgIG5ld0J1ZmZlci5zZXQoZGF0YSk7XG4gICAgICAgIGFsbFNpbGVudCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2lsZW50IGJ1ZmZlcnMgYXJlIG5vdCBjb3BpZWQsIGJ1dCB3ZSBzdG9yZSBlbXB0eSBidWZmZXJzIHNvIHRoYXQgdGhlXG4gICAgICAgIC8vIGFuYWx5c2lzIGRvZXNuJ3QgaGF2ZSB0byBjYXJlLlxuICAgICAgICBuZXdCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KCk7XG4gICAgICB9XG4gICAgICB0aGlzLmNvbGxlY3RlZEF1ZGlvW2NdLnB1c2gobmV3QnVmZmVyKTtcbiAgICB9XG4gICAgaWYgKCFhbGxTaWxlbnQpIHtcbiAgICAgIHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgKz0gc2FtcGxlQ291bnQ7XG4gICAgICBpZiAoKHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgLyBldmVudC5pbnB1dEJ1ZmZlci5zYW1wbGVSYXRlKSA+PVxuICAgICAgICAgIHRoaXMuY29sbGVjdFNlY29uZHMpIHtcbiAgICAgICAgdGhpcy5zdG9wQ29sbGVjdGluZ0F1ZGlvKCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIG9uU3RvcENvbGxlY3RpbmdBdWRpbzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHJlYW0uZ2V0QXVkaW9UcmFja3MoKVswXS5zdG9wKCk7XG4gICAgdGhpcy5hdWRpb1NvdXJjZS5kaXNjb25uZWN0KHRoaXMuc2NyaXB0Tm9kZSk7XG4gICAgdGhpcy5zY3JpcHROb2RlLmRpc2Nvbm5lY3QodGhpcy5hdWRpb0NvbnRleHQuZGVzdGluYXRpb24pO1xuICAgIHRoaXMuYW5hbHl6ZUF1ZGlvKHRoaXMuY29sbGVjdGVkQXVkaW8pO1xuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH0sXG5cbiAgYW5hbHl6ZUF1ZGlvOiBmdW5jdGlvbihjaGFubmVscykge1xuICAgIHZhciBhY3RpdmVDaGFubmVscyA9IFtdO1xuICAgIGZvciAodmFyIGMgPSAwOyBjIDwgY2hhbm5lbHMubGVuZ3RoOyBjKyspIHtcbiAgICAgIGlmICh0aGlzLmNoYW5uZWxTdGF0cyhjLCBjaGFubmVsc1tjXSkpIHtcbiAgICAgICAgYWN0aXZlQ2hhbm5lbHMucHVzaChjKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGFjdGl2ZUNoYW5uZWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyBhY3RpdmUgaW5wdXQgY2hhbm5lbHMgZGV0ZWN0ZWQuIE1pY3JvcGhvbmUgJyArXG4gICAgICAgICAgJ2lzIG1vc3QgbGlrZWx5IG11dGVkIG9yIGJyb2tlbiwgcGxlYXNlIGNoZWNrIGlmIG11dGVkIGluIHRoZSAnICtcbiAgICAgICAgICAnc291bmQgc2V0dGluZ3Mgb3IgcGh5c2ljYWxseSBvbiB0aGUgZGV2aWNlLiBUaGVuIHJlcnVuIHRoZSB0ZXN0LicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQWN0aXZlIGF1ZGlvIGlucHV0IGNoYW5uZWxzOiAnICtcbiAgICAgICAgICBhY3RpdmVDaGFubmVscy5sZW5ndGgpO1xuICAgIH1cbiAgICBpZiAoYWN0aXZlQ2hhbm5lbHMubGVuZ3RoID09PSAyKSB7XG4gICAgICB0aGlzLmRldGVjdE1vbm8oY2hhbm5lbHNbYWN0aXZlQ2hhbm5lbHNbMF1dLCBjaGFubmVsc1thY3RpdmVDaGFubmVsc1sxXV0pO1xuICAgIH1cbiAgfSxcblxuICBjaGFubmVsU3RhdHM6IGZ1bmN0aW9uKGNoYW5uZWxOdW1iZXIsIGJ1ZmZlcnMpIHtcbiAgICB2YXIgbWF4UGVhayA9IDAuMDtcbiAgICB2YXIgbWF4Um1zID0gMC4wO1xuICAgIHZhciBjbGlwQ291bnQgPSAwO1xuICAgIHZhciBtYXhDbGlwQ291bnQgPSAwO1xuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYnVmZmVycy5sZW5ndGg7IGorKykge1xuICAgICAgdmFyIHNhbXBsZXMgPSBidWZmZXJzW2pdO1xuICAgICAgaWYgKHNhbXBsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB2YXIgcyA9IDA7XG4gICAgICAgIHZhciBybXMgPSAwLjA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2FtcGxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHMgPSBNYXRoLmFicyhzYW1wbGVzW2ldKTtcbiAgICAgICAgICBtYXhQZWFrID0gTWF0aC5tYXgobWF4UGVhaywgcyk7XG4gICAgICAgICAgcm1zICs9IHMgKiBzO1xuICAgICAgICAgIGlmIChtYXhQZWFrID49IHRoaXMuY2xpcFRocmVzaG9sZCkge1xuICAgICAgICAgICAgY2xpcENvdW50Kys7XG4gICAgICAgICAgICBtYXhDbGlwQ291bnQgPSBNYXRoLm1heChtYXhDbGlwQ291bnQsIGNsaXBDb3VudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsaXBDb3VudCA9IDA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFJNUyBpcyBjYWxjdWxhdGVkIG92ZXIgZWFjaCBidWZmZXIsIG1lYW5pbmcgdGhlIGludGVncmF0aW9uIHRpbWUgd2lsbFxuICAgICAgICAvLyBiZSBkaWZmZXJlbnQgZGVwZW5kaW5nIG9uIHNhbXBsZSByYXRlIGFuZCBidWZmZXIgc2l6ZS4gSW4gcHJhY3Rpc2VcbiAgICAgICAgLy8gdGhpcyBzaG91bGQgYmUgYSBzbWFsbCBwcm9ibGVtLlxuICAgICAgICBybXMgPSBNYXRoLnNxcnQocm1zIC8gc2FtcGxlcy5sZW5ndGgpO1xuICAgICAgICBtYXhSbXMgPSBNYXRoLm1heChtYXhSbXMsIHJtcyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1heFBlYWsgPiB0aGlzLnNpbGVudFRocmVzaG9sZCkge1xuICAgICAgdmFyIGRCUGVhayA9IHRoaXMuZEJGUyhtYXhQZWFrKTtcbiAgICAgIHZhciBkQlJtcyA9IHRoaXMuZEJGUyhtYXhSbXMpO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0NoYW5uZWwgJyArIGNoYW5uZWxOdW1iZXIgKyAnIGxldmVsczogJyArXG4gICAgICAgICAgZEJQZWFrLnRvRml4ZWQoMSkgKyAnIGRCIChwZWFrKSwgJyArIGRCUm1zLnRvRml4ZWQoMSkgKyAnIGRCIChSTVMpJyk7XG4gICAgICBpZiAoZEJSbXMgPCB0aGlzLmxvd1ZvbHVtZVRocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ01pY3JvcGhvbmUgaW5wdXQgbGV2ZWwgaXMgbG93LCBpbmNyZWFzZSBpbnB1dCAnICtcbiAgICAgICAgICAgICd2b2x1bWUgb3IgbW92ZSBjbG9zZXIgdG8gdGhlIG1pY3JvcGhvbmUuJyk7XG4gICAgICB9XG4gICAgICBpZiAobWF4Q2xpcENvdW50ID4gdGhpcy5jbGlwQ291bnRUaHJlc2hvbGQpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0NsaXBwaW5nIGRldGVjdGVkISBNaWNyb3Bob25lIGlucHV0IGxldmVsICcgK1xuICAgICAgICAgICAgJ2lzIGhpZ2guIERlY3JlYXNlIGlucHV0IHZvbHVtZSBvciBtb3ZlIGF3YXkgZnJvbSB0aGUgbWljcm9waG9uZS4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG5cbiAgZGV0ZWN0TW9ubzogZnVuY3Rpb24oYnVmZmVyc0wsIGJ1ZmZlcnNSKSB7XG4gICAgdmFyIGRpZmZTYW1wbGVzID0gMDtcbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGJ1ZmZlcnNMLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgbCA9IGJ1ZmZlcnNMW2pdO1xuICAgICAgdmFyIHIgPSBidWZmZXJzUltqXTtcbiAgICAgIGlmIChsLmxlbmd0aCA9PT0gci5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGQgPSAwLjA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGQgPSBNYXRoLmFicyhsW2ldIC0gcltpXSk7XG4gICAgICAgICAgaWYgKGQgPiB0aGlzLm1vbm9EZXRlY3RUaHJlc2hvbGQpIHtcbiAgICAgICAgICAgIGRpZmZTYW1wbGVzKys7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaWZmU2FtcGxlcysrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZGlmZlNhbXBsZXMgPiAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU3RlcmVvIG1pY3JvcGhvbmUgZGV0ZWN0ZWQuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdNb25vIG1pY3JvcGhvbmUgZGV0ZWN0ZWQuJyk7XG4gICAgfVxuICB9LFxuXG4gIGRCRlM6IGZ1bmN0aW9uKGdhaW4pIHtcbiAgICB2YXIgZEIgPSAyMCAqIE1hdGgubG9nKGdhaW4pIC8gTWF0aC5sb2coMTApO1xuICAgIC8vIFVzZSBNYXRoLnJvdW5kIHRvIGRpc3BsYXkgdXAgdG8gb25lIGRlY2ltYWwgcGxhY2UuXG4gICAgcmV0dXJuIE1hdGgucm91bmQoZEIgKiAxMCkgLyAxMDtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IE1pY1Rlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL0NhbGwuanMnO1xuXG52YXIgTmV0d29ya1Rlc3QgPSBmdW5jdGlvbih0ZXN0LCBwcm90b2NvbCwgcGFyYW1zLCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sO1xuICB0aGlzLnBhcmFtcyA9IHBhcmFtcztcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG59O1xuXG5OZXR3b3JrVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgLy8gRG8gbm90IGNyZWF0ZSB0dXJuIGNvbmZpZyBmb3IgSVBWNiB0ZXN0LlxuICAgIGlmICh0aGlzLmljZUNhbmRpZGF0ZUZpbHRlci50b1N0cmluZygpID09PSBDYWxsLmlzSXB2Ni50b1N0cmluZygpKSB7XG4gICAgICB0aGlzLmdhdGhlckNhbmRpZGF0ZXMobnVsbCwgdGhpcy5wYXJhbXMsIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksIHRoaXMudGVzdCk7XG4gICAgfVxuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLmZpbHRlckNvbmZpZyhjb25maWcsIHRoaXMucHJvdG9jb2wpO1xuICAgIHRoaXMuZ2F0aGVyQ2FuZGlkYXRlcyhjb25maWcsIHRoaXMucGFyYW1zLCB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcik7XG4gIH0sXG5cbiAgLy8gRmlsdGVyIHRoZSBSVENDb25maWd1cmF0aW9uIHxjb25maWd8IHRvIG9ubHkgY29udGFpbiBVUkxzIHdpdGggdGhlXG4gIC8vIHNwZWNpZmllZCB0cmFuc3BvcnQgcHJvdG9jb2wgfHByb3RvY29sfC4gSWYgbm8gdHVybiB0cmFuc3BvcnQgaXNcbiAgLy8gc3BlY2lmaWVkIGl0IGlzIGFkZGVkIHdpdGggdGhlIHJlcXVlc3RlZCBwcm90b2NvbC5cbiAgZmlsdGVyQ29uZmlnOiBmdW5jdGlvbihjb25maWcsIHByb3RvY29sKSB7XG4gICAgdmFyIHRyYW5zcG9ydCA9ICd0cmFuc3BvcnQ9JyArIHByb3RvY29sO1xuICAgIHZhciBuZXdJY2VTZXJ2ZXJzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb25maWcuaWNlU2VydmVycy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGljZVNlcnZlciA9IGNvbmZpZy5pY2VTZXJ2ZXJzW2ldO1xuICAgICAgdmFyIG5ld1VybHMgPSBbXTtcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgaWNlU2VydmVyLnVybHMubGVuZ3RoOyArK2opIHtcbiAgICAgICAgdmFyIHVyaSA9IGljZVNlcnZlci51cmxzW2pdO1xuICAgICAgICBpZiAodXJpLmluZGV4T2YodHJhbnNwb3J0KSAhPT0gLTEpIHtcbiAgICAgICAgICBuZXdVcmxzLnB1c2godXJpKTtcbiAgICAgICAgfSBlbHNlIGlmICh1cmkuaW5kZXhPZignP3RyYW5zcG9ydD0nKSA9PT0gLTEgJiZcbiAgICAgICAgICAgIHVyaS5zdGFydHNXaXRoKCd0dXJuJykpIHtcbiAgICAgICAgICBuZXdVcmxzLnB1c2godXJpICsgJz8nICsgdHJhbnNwb3J0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG5ld1VybHMubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgIGljZVNlcnZlci51cmxzID0gbmV3VXJscztcbiAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKGljZVNlcnZlcik7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbmZpZy5pY2VTZXJ2ZXJzID0gbmV3SWNlU2VydmVycztcbiAgfSxcblxuICAvLyBDcmVhdGUgYSBQZWVyQ29ubmVjdGlvbiwgYW5kIGdhdGhlciBjYW5kaWRhdGVzIHVzaW5nIFJUQ0NvbmZpZyB8Y29uZmlnfFxuICAvLyBhbmQgY3RvciBwYXJhbXMgfHBhcmFtc3wuIFN1Y2NlZWQgaWYgYW55IGNhbmRpZGF0ZXMgcGFzcyB0aGUgfGlzR29vZHxcbiAgLy8gY2hlY2ssIGZhaWwgaWYgd2UgY29tcGxldGUgZ2F0aGVyaW5nIHdpdGhvdXQgYW55IHBhc3NpbmcuXG4gIGdhdGhlckNhbmRpZGF0ZXM6IGZ1bmN0aW9uKGNvbmZpZywgcGFyYW1zLCBpc0dvb2QpIHtcbiAgICB2YXIgcGM7XG4gICAgdHJ5IHtcbiAgICAgIHBjID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZywgcGFyYW1zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHBhcmFtcyAhPT0gbnVsbCAmJiBwYXJhbXMub3B0aW9uYWxbMF0uZ29vZ0lQdjYpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0ZhaWxlZCB0byBjcmVhdGUgcGVlciBjb25uZWN0aW9uLCBJUHY2ICcgK1xuICAgICAgICAgICAgJ21pZ2h0IG5vdCBiZSBzZXR1cC9zdXBwb3J0ZWQgb24gdGhlIG5ldHdvcmsuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgcGVlciBjb25uZWN0aW9uOiAnICsgZXJyb3IpO1xuICAgICAgfVxuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJbiBvdXIgY2FuZGlkYXRlIGNhbGxiYWNrLCBzdG9wIGlmIHdlIGdldCBhIGNhbmRpZGF0ZSB0aGF0IHBhc3Nlc1xuICAgIC8vIHxpc0dvb2R8LlxuICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIC8vIE9uY2Ugd2UndmUgZGVjaWRlZCwgaWdub3JlIGZ1dHVyZSBjYWxsYmFja3MuXG4gICAgICBpZiAoZS5jdXJyZW50VGFyZ2V0LnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChlLmNhbmRpZGF0ZSkge1xuICAgICAgICB2YXIgcGFyc2VkID0gQ2FsbC5wYXJzZUNhbmRpZGF0ZShlLmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgICBpZiAoaXNHb29kKHBhcnNlZCkpIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnR2F0aGVyZWQgY2FuZGlkYXRlIG9mIFR5cGU6ICcgKyBwYXJzZWQudHlwZSArXG4gICAgICAgICAgICAgICcgUHJvdG9jb2w6ICcgKyBwYXJzZWQucHJvdG9jb2wgKyAnIEFkZHJlc3M6ICcgKyBwYXJzZWQuYWRkcmVzcyk7XG4gICAgICAgICAgcGMuY2xvc2UoKTtcbiAgICAgICAgICBwYyA9IG51bGw7XG4gICAgICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGMuY2xvc2UoKTtcbiAgICAgICAgcGMgPSBudWxsO1xuICAgICAgICBpZiAocGFyYW1zICE9PSBudWxsICYmIHBhcmFtcy5vcHRpb25hbFswXS5nb29nSVB2Nikge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdGYWlsZWQgdG8gZ2F0aGVyIElQdjYgY2FuZGlkYXRlcywgaXQgJyArXG4gICAgICAgICAgICAgICdtaWdodCBub3QgYmUgc2V0dXAvc3VwcG9ydGVkIG9uIHRoZSBuZXR3b3JrLicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignRmFpbGVkIHRvIGdhdGhlciBzcGVjaWZpZWQgY2FuZGlkYXRlcycpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICB9XG4gICAgfS5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMuY3JlYXRlQXVkaW9Pbmx5UmVjZWl2ZU9mZmVyKHBjKTtcbiAgfSxcblxuICAvLyBDcmVhdGUgYW4gYXVkaW8tb25seSwgcmVjdm9ubHkgb2ZmZXIsIGFuZCBzZXRMRCB3aXRoIGl0LlxuICAvLyBUaGlzIHdpbGwgdHJpZ2dlciBjYW5kaWRhdGUgZ2F0aGVyaW5nLlxuICBjcmVhdGVBdWRpb09ubHlSZWNlaXZlT2ZmZXI6IGZ1bmN0aW9uKHBjKSB7XG4gICAgdmFyIGNyZWF0ZU9mZmVyUGFyYW1zID0ge29mZmVyVG9SZWNlaXZlQXVkaW86IDF9O1xuICAgIHBjLmNyZWF0ZU9mZmVyKFxuICAgICAgICBjcmVhdGVPZmZlclBhcmFtc1xuICAgICkudGhlbihcbiAgICAgICAgZnVuY3Rpb24ob2ZmZXIpIHtcbiAgICAgICAgICBwYy5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKS50aGVuKFxuICAgICAgICAgICAgICBub29wLFxuICAgICAgICAgICAgICBub29wXG4gICAgICAgICAgKTtcbiAgICAgICAgfSxcbiAgICAgICAgbm9vcFxuICAgICk7XG5cbiAgICAvLyBFbXB0eSBmdW5jdGlvbiBmb3IgY2FsbGJhY2tzIHJlcXVpcmluZyBhIGZ1bmN0aW9uLlxuICAgIGZ1bmN0aW9uIG5vb3AoKSB7fVxuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBOZXR3b3JrVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBhZGFwdGVyIGZyb20gJ3dlYnJ0Yy1hZGFwdGVyJztcbmltcG9ydCBTdGF0aXN0aWNzQWdncmVnYXRlIGZyb20gJy4uL3V0aWwvc3RhdHMuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9jYWxsLmpzJztcblxuZnVuY3Rpb24gVmlkZW9CYW5kd2lkdGhUZXN0KHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5tYXhWaWRlb0JpdHJhdGVLYnBzID0gMjAwMDtcbiAgdGhpcy5kdXJhdGlvbk1zID0gNDAwMDA7XG4gIHRoaXMuc3RhdFN0ZXBNcyA9IDEwMDtcbiAgdGhpcy5id2VTdGF0cyA9IG5ldyBTdGF0aXN0aWNzQWdncmVnYXRlKDAuNzUgKiB0aGlzLm1heFZpZGVvQml0cmF0ZUticHMgKlxuICAgICAgMTAwMCk7XG4gIHRoaXMucnR0U3RhdHMgPSBuZXcgU3RhdGlzdGljc0FnZ3JlZ2F0ZSgpO1xuICB0aGlzLnBhY2tldHNMb3N0ID0gLTE7XG4gIHRoaXMubmFja0NvdW50ID0gLTE7XG4gIHRoaXMucGxpQ291bnQgPSAtMTtcbiAgdGhpcy5xcFN1bSA9IC0xO1xuICB0aGlzLnBhY2tldHNTZW50ID0gLTE7XG4gIHRoaXMucGFja2V0c1JlY2VpdmVkID0gLTE7XG4gIHRoaXMuZnJhbWVzRW5jb2RlZCA9IC0xO1xuICB0aGlzLmZyYW1lc0RlY29kZWQgPSAtMTtcbiAgdGhpcy5mcmFtZXNTZW50ID0gLTE7XG4gIHRoaXMuYnl0ZXNTZW50ID0gLTE7XG4gIHRoaXMudmlkZW9TdGF0cyA9IFtdO1xuICB0aGlzLnN0YXJ0VGltZSA9IG51bGw7XG4gIHRoaXMuY2FsbCA9IG51bGw7XG4gIC8vIE9wZW4gdGhlIGNhbWVyYSBpbiA3MjBwIHRvIGdldCBhIGNvcnJlY3QgbWVhc3VyZW1lbnQgb2YgcmFtcC11cCB0aW1lLlxuICB0aGlzLmNvbnN0cmFpbnRzID0ge1xuICAgIGF1ZGlvOiBmYWxzZSxcbiAgICB2aWRlbzoge1xuICAgICAgb3B0aW9uYWw6IFtcbiAgICAgICAge21pbldpZHRoOiAxMjgwfSxcbiAgICAgICAge21pbkhlaWdodDogNzIwfVxuICAgICAgXVxuICAgIH1cbiAgfTtcbn1cblxuVmlkZW9CYW5kd2lkdGhUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksIHRoaXMudGVzdCk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKENhbGwuaXNSZWxheSk7XG4gICAgLy8gRkVDIG1ha2VzIGl0IGhhcmQgdG8gc3R1ZHkgYmFuZHdpZHRoIGVzdGltYXRpb24gc2luY2UgdGhlcmUgc2VlbXMgdG8gYmVcbiAgICAvLyBhIHNwaWtlIHdoZW4gaXQgaXMgZW5hYmxlZCBhbmQgZGlzYWJsZWQuIERpc2FibGUgaXQgZm9yIG5vdy4gRkVDIGlzc3VlXG4gICAgLy8gdHJhY2tlZCBvbjogaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD0zMDUwXG4gICAgdGhpcy5jYWxsLmRpc2FibGVWaWRlb0ZlYygpO1xuICAgIHRoaXMuY2FsbC5jb25zdHJhaW5WaWRlb0JpdHJhdGUodGhpcy5tYXhWaWRlb0JpdHJhdGVLYnBzKTtcbiAgICB0aGlzLnRlc3QuZG9HZXRVc2VyTWVkaWEodGhpcy5jb25zdHJhaW50cywgdGhpcy5nb3RTdHJlYW0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgZ290U3RyZWFtOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICB0aGlzLmNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIHRoaXMuY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIHRoaXMubG9jYWxTdHJlYW0gPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXTtcbiAgICBzZXRUaW1lb3V0KHRoaXMuZ2F0aGVyU3RhdHMuYmluZCh0aGlzKSwgdGhpcy5zdGF0U3RlcE1zKTtcbiAgfSxcblxuICBnYXRoZXJTdGF0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgaWYgKG5vdyAtIHRoaXMuc3RhcnRUaW1lID4gdGhpcy5kdXJhdGlvbk1zKSB7XG4gICAgICB0aGlzLnRlc3Quc2V0UHJvZ3Jlc3MoMTAwKTtcbiAgICAgIHRoaXMuaGFuZ3VwKCk7XG4gICAgICByZXR1cm47XG4gICAgfSBlbHNlIGlmICghdGhpcy5jYWxsLnN0YXRzR2F0aGVyaW5nUnVubmluZykge1xuICAgICAgdGhpcy5jYWxsLmdhdGhlclN0YXRzKHRoaXMuY2FsbC5wYzEsIHRoaXMuY2FsbC5wYzIsIHRoaXMubG9jYWxTdHJlYW0sXG4gICAgICAgICAgdGhpcy5nb3RTdGF0cy5iaW5kKHRoaXMpKTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LnNldFByb2dyZXNzKChub3cgLSB0aGlzLnN0YXJ0VGltZSkgKiAxMDAgLyB0aGlzLmR1cmF0aW9uTXMpO1xuICAgIHNldFRpbWVvdXQodGhpcy5nYXRoZXJTdGF0cy5iaW5kKHRoaXMpLCB0aGlzLnN0YXRTdGVwTXMpO1xuICB9LFxuXG4gIGdvdFN0YXRzOiBmdW5jdGlvbihyZXNwb25zZSwgdGltZSwgcmVzcG9uc2UyLCB0aW1lMikge1xuICAgIC8vIFRPRE86IFJlbW92ZSBicm93c2VyIHNwZWNpZmljIHN0YXRzIGdhdGhlcmluZyBoYWNrIG9uY2UgYWRhcHRlci5qcyBvclxuICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgIGZvciAodmFyIGkgaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXNwb25zZVtpXS5jb25uZWN0aW9uICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIHRoaXMuYndlU3RhdHMuYWRkKHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24udGltZXN0YW1wLFxuICAgICAgICAgICAgICBwYXJzZUludChyZXNwb25zZVtpXS5jb25uZWN0aW9uLmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZSkpO1xuICAgICAgICAgIHRoaXMucnR0U3RhdHMuYWRkKHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24udGltZXN0YW1wLFxuICAgICAgICAgICAgICBwYXJzZUludChyZXNwb25zZVtpXS5jb25uZWN0aW9uLmN1cnJlbnRSb3VuZFRyaXBUaW1lICogMTAwMCkpO1xuICAgICAgICAgIC8vIEdyYWIgdGhlIGxhc3Qgc3RhdHMuXG4gICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzBdID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwuZnJhbWVXaWR0aDtcbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5mcmFtZUhlaWdodDtcbiAgICAgICAgICB0aGlzLm5hY2tDb3VudCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLm5hY2tDb3VudDtcbiAgICAgICAgICB0aGlzLnBhY2tldHNMb3N0ID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5wYWNrZXRzTG9zdDtcbiAgICAgICAgICB0aGlzLnFwU3VtID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5xcFN1bTtcbiAgICAgICAgICB0aGlzLnBsaUNvdW50ID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwucGxpQ291bnQ7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzU2VudCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLnBhY2tldHNTZW50O1xuICAgICAgICAgIHRoaXMucGFja2V0c1JlY2VpdmVkID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgdGhpcy5mcmFtZXNFbmNvZGVkID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwuZnJhbWVzRW5jb2RlZDtcbiAgICAgICAgICB0aGlzLmZyYW1lc0RlY29kZWQgPSByZXNwb25zZTJbaV0udmlkZW8ucmVtb3RlLmZyYW1lc0RlY29kZWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICBmb3IgKHZhciBqIGluIHJlc3BvbnNlKSB7XG4gICAgICAgIGlmIChyZXNwb25zZVtqXS5pZCA9PT0gJ291dGJvdW5kX3J0Y3BfdmlkZW9fMCcpIHtcbiAgICAgICAgICB0aGlzLnJ0dFN0YXRzLmFkZChEYXRlLnBhcnNlKHJlc3BvbnNlW2pdLnRpbWVzdGFtcCksXG4gICAgICAgICAgICAgIHBhcnNlSW50KHJlc3BvbnNlW2pdLm1velJ0dCkpO1xuICAgICAgICAgIC8vIEdyYWIgdGhlIGxhc3Qgc3RhdHMuXG4gICAgICAgICAgdGhpcy5qaXR0ZXIgPSByZXNwb25zZVtqXS5qaXR0ZXI7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzTG9zdCA9IHJlc3BvbnNlW2pdLnBhY2tldHNMb3N0O1xuICAgICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlW2pdLmlkID09PSAnb3V0Ym91bmRfcnRwX3ZpZGVvXzAnKSB7XG4gICAgICAgICAgLy8gVE9ETzogR2V0IGRpbWVuc2lvbnMgZnJvbSBnZXRTdGF0cyB3aGVuIHN1cHBvcnRlZCBpbiBGRi5cbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMF0gPSAnTm90IHN1cHBvcnRlZCBvbiBGaXJlZm94JztcbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gPSAnTm90IHN1cHBvcnRlZCBvbiBGaXJlZm94JztcbiAgICAgICAgICB0aGlzLmJpdHJhdGVNZWFuID0gcmVzcG9uc2Vbal0uYml0cmF0ZU1lYW47XG4gICAgICAgICAgdGhpcy5iaXRyYXRlU3RkRGV2ID0gcmVzcG9uc2Vbal0uYml0cmF0ZVN0ZERldjtcbiAgICAgICAgICB0aGlzLmZyYW1lcmF0ZU1lYW4gPSByZXNwb25zZVtqXS5mcmFtZXJhdGVNZWFuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgaW1wbGVtZW50YXRpb25zJyArXG4gICAgICAgICcgYXJlIHN1cHBvcnRlZC4nKTtcbiAgICB9XG4gICAgdGhpcy5jb21wbGV0ZWQoKTtcbiAgfSxcblxuICBoYW5ndXA6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY2FsbC5wYzEuZ2V0TG9jYWxTdHJlYW1zKClbMF0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIHRoaXMuY2FsbC5jbG9zZSgpO1xuICAgIHRoaXMuY2FsbCA9IG51bGw7XG4gIH0sXG5cbiAgY29tcGxldGVkOiBmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAvLyBDaGVja2luZyBpZiBncmVhdGVyIHRoYW4gMiBiZWNhdXNlIENocm9tZSBzb21ldGltZXMgcmVwb3J0cyAyeDIgd2hlblxuICAgICAgLy8gYSBjYW1lcmEgc3RhcnRzIGJ1dCBmYWlscyB0byBkZWxpdmVyIGZyYW1lcy5cbiAgICAgIGlmICh0aGlzLnZpZGVvU3RhdHNbMF0gPCAyICYmIHRoaXMudmlkZW9TdGF0c1sxXSA8IDIpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZmFpbHVyZTogJyArIHRoaXMudmlkZW9TdGF0c1swXSArICd4JyArXG4gICAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gKyAnLiBDYW5ub3QgdGVzdCBiYW5kd2lkdGggd2l0aG91dCBhIHdvcmtpbmcgJyArXG4gICAgICAgICAgICAnIGNhbWVyYS4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdWaWRlbyByZXNvbHV0aW9uOiAnICsgdGhpcy52aWRlb1N0YXRzWzBdICtcbiAgICAgICAgICAgICd4JyArIHRoaXMudmlkZW9TdGF0c1sxXSk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJhbmR3aWR0aCBlc3RpbWF0ZSBhdmVyYWdlOiAnICtcbiAgICAgICAgICAgIE1hdGgucm91bmQodGhpcy5id2VTdGF0cy5nZXRBdmVyYWdlKCkgLyAxMDAwKSArICcga2JwcycpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiYW5kd2lkdGggZXN0aW1hdGUgbWF4OiAnICtcbiAgICAgICAgICAgIHRoaXMuYndlU3RhdHMuZ2V0TWF4KCkgLyAxMDAwICsgJyBrYnBzJyk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJhbmR3aWR0aCByYW1wLXVwIHRpbWU6ICcgK1xuICAgICAgICAgICAgdGhpcy5id2VTdGF0cy5nZXRSYW1wVXBUaW1lKCkgKyAnIG1zJyk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdQYWNrZXRzIHNlbnQ6ICcgKyB0aGlzLnBhY2tldHNTZW50KTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BhY2tldHMgcmVjZWl2ZWQ6ICcgKyB0aGlzLnBhY2tldHNSZWNlaXZlZCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOQUNLIGNvdW50OiAnICsgdGhpcy5uYWNrQ291bnQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUGljdHVyZSBsb3NzIGluZGljYXRpb25zOiAnICsgdGhpcy5wbGlDb3VudCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdRdWFsaXR5IHByZWRpY3RvciBzdW06ICcgKyB0aGlzLnFwU3VtKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0ZyYW1lcyBlbmNvZGVkOiAnICsgdGhpcy5mcmFtZXNFbmNvZGVkKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0ZyYW1lcyBkZWNvZGVkOiAnICsgdGhpcy5mcmFtZXNEZWNvZGVkKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICBpZiAocGFyc2VJbnQodGhpcy5mcmFtZXJhdGVNZWFuKSA+IDApIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0ZyYW1lIHJhdGUgbWVhbjogJyArXG4gICAgICAgICAgICBwYXJzZUludCh0aGlzLmZyYW1lcmF0ZU1lYW4pKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignRnJhbWUgcmF0ZSBtZWFuIGlzIDAsIGNhbm5vdCB0ZXN0IGJhbmR3aWR0aCAnICtcbiAgICAgICAgICAgICd3aXRob3V0IGEgd29ya2luZyBjYW1lcmEuJyk7XG4gICAgICB9XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiaXRyYXRlIG1lYW46ICcgK1xuICAgICAgICAgIHBhcnNlSW50KHRoaXMuYml0cmF0ZU1lYW4pIC8gMTAwMCArICcga2JwcycpO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYml0cmF0ZSBzdGFuZGFyZCBkZXZpYXRpb246ICcgK1xuICAgICAgICAgIHBhcnNlSW50KHRoaXMuYml0cmF0ZVN0ZERldikgLyAxMDAwICsgJyBrYnBzJyk7XG4gICAgfVxuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdSVFQgYXZlcmFnZTogJyArIHRoaXMucnR0U3RhdHMuZ2V0QXZlcmFnZSgpICtcbiAgICAgICAgICAgICcgbXMnKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUlRUIG1heDogJyArIHRoaXMucnR0U3RhdHMuZ2V0TWF4KCkgKyAnIG1zJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BhY2tldHMgbG9zdDogJyArIHRoaXMucGFja2V0c0xvc3QpO1xuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFZpZGVvQmFuZHdpZHRoVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvY2FsbC5qcyc7XG5pbXBvcnQgUmVwb3J0IGZyb20gJy4uL3V0aWwvcmVwb3J0LmpzJztcbmltcG9ydCB7IGFycmF5QXZlcmFnZSwgYXJyYXlNaW4sIGFycmF5TWF4IH0gZnJvbSAnLi4vdXRpbC91dGlsLmpzJztcblxuY29uc3QgcmVwb3J0ID0gbmV3IFJlcG9ydCgpO1xuXG5mdW5jdGlvbiBXaUZpUGVyaW9kaWNTY2FuVGVzdCh0ZXN0LCBjYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5jYW5kaWRhdGVGaWx0ZXIgPSBjYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGVzdER1cmF0aW9uTXMgPSA1ICogNjAgKiAxMDAwO1xuICB0aGlzLnNlbmRJbnRlcnZhbE1zID0gMTAwO1xuICB0aGlzLmRlbGF5cyA9IFtdO1xuICB0aGlzLnJlY3ZUaW1lU3RhbXBzID0gW107XG4gIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuV2lGaVBlcmlvZGljU2NhblRlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIENhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnKHRoaXMuc3RhcnQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSwgdGhpcy50ZXN0KTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5ydW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmNhbGwgPSBuZXcgQ2FsbChjb25maWcsIHRoaXMudGVzdCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcih0aGlzLmNhbmRpZGF0ZUZpbHRlcik7XG5cbiAgICB0aGlzLnNlbmRlckNoYW5uZWwgPSB0aGlzLmNhbGwucGMxLmNyZWF0ZURhdGFDaGFubmVsKHtvcmRlcmVkOiBmYWxzZSxcbiAgICAgIG1heFJldHJhbnNtaXRzOiAwfSk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLnNlbmQuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsXG4gICAgICAgIHRoaXMub25SZWNlaXZlckNoYW5uZWwuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZmluaXNoVGVzdC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3REdXJhdGlvbk1zKTtcbiAgfSxcblxuICBvblJlY2VpdmVyQ2hhbm5lbDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsID0gZXZlbnQuY2hhbm5lbDtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0aGlzLnJlY2VpdmUuYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgc2VuZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLnNlbmQoJycgKyBEYXRlLm5vdygpKTtcbiAgICBzZXRUaW1lb3V0KHRoaXMuc2VuZC5iaW5kKHRoaXMpLCB0aGlzLnNlbmRJbnRlcnZhbE1zKTtcbiAgfSxcblxuICByZWNlaXZlOiBmdW5jdGlvbihldmVudCkge1xuICAgIGlmICghdGhpcy5ydW5uaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBzZW5kVGltZSA9IHBhcnNlSW50KGV2ZW50LmRhdGEpO1xuICAgIHZhciBkZWxheSA9IERhdGUubm93KCkgLSBzZW5kVGltZTtcbiAgICB0aGlzLnJlY3ZUaW1lU3RhbXBzLnB1c2goc2VuZFRpbWUpO1xuICAgIHRoaXMuZGVsYXlzLnB1c2goZGVsYXkpO1xuICB9LFxuXG4gIGZpbmlzaFRlc3Q6IGZ1bmN0aW9uKCkge1xuICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgncGVyaW9kaWMtZGVsYXknLCB7ZGVsYXlzOiB0aGlzLmRlbGF5cyxcbiAgICAgIHJlY3ZUaW1lU3RhbXBzOiB0aGlzLnJlY3ZUaW1lU3RhbXBzfSk7XG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy5jYWxsID0gbnVsbDtcblxuICAgIHZhciBhdmcgPSBhcnJheUF2ZXJhZ2UodGhpcy5kZWxheXMpO1xuICAgIHZhciBtYXggPSBhcnJheU1heCh0aGlzLmRlbGF5cyk7XG4gICAgdmFyIG1pbiA9IGFycmF5TWluKHRoaXMuZGVsYXlzKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnQXZlcmFnZSBkZWxheTogJyArIGF2ZyArICcgbXMuJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ01pbiBkZWxheTogJyArIG1pbiArICcgbXMuJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ01heCBkZWxheTogJyArIG1heCArICcgbXMuJyk7XG5cbiAgICBpZiAodGhpcy5kZWxheXMubGVuZ3RoIDwgMC44ICogdGhpcy50ZXN0RHVyYXRpb25NcyAvIHRoaXMuc2VuZEludGVydmFsTXMpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm90IGVub3VnaCBzYW1wbGVzIGdhdGhlcmVkLiBLZWVwIHRoZSBwYWdlIG9uICcgK1xuICAgICAgICAgICcgdGhlIGZvcmVncm91bmQgd2hpbGUgdGhlIHRlc3QgaXMgcnVubmluZy4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0NvbGxlY3RlZCAnICsgdGhpcy5kZWxheXMubGVuZ3RoICtcbiAgICAgICAgICAnIGRlbGF5IHNhbXBsZXMuJyk7XG4gICAgfVxuXG4gICAgaWYgKG1heCA+IChtaW4gKyAxMDApICogMikge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdUaGVyZSBpcyBhIGJpZyBkaWZmZXJlbmNlIGJldHdlZW4gdGhlIG1pbiBhbmQgJyArXG4gICAgICAgICAgJ21heCBkZWxheSBvZiBwYWNrZXRzLiBZb3VyIG5ldHdvcmsgYXBwZWFycyB1bnN0YWJsZS4nKTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgV2lGaVBlcmlvZGljU2NhblRlc3Q7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcbmltcG9ydCBhZGFwdGVyIGZyb20gJ3dlYnJ0Yy1hZGFwdGVyJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi9yZXBvcnQuanMnO1xuaW1wb3J0IHsgZW51bWVyYXRlU3RhdHMgfSBmcm9tICcuL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG5cbmZ1bmN0aW9uIENhbGwoY29uZmlnLCB0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMudHJhY2VFdmVudCA9IHJlcG9ydC50cmFjZUV2ZW50QXN5bmMoJ2NhbGwnKTtcbiAgdGhpcy50cmFjZUV2ZW50KHtjb25maWc6IGNvbmZpZ30pO1xuICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuXG4gIHRoaXMucGMxID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG4gIHRoaXMucGMyID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG5cbiAgdGhpcy5wYzEuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzIpKTtcbiAgdGhpcy5wYzIuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzEpKTtcblxuICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBDYWxsLm5vRmlsdGVyO1xufVxuXG5DYWxsLnByb3RvdHlwZSA9IHtcbiAgZXN0YWJsaXNoQ29ubmVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ3N0YXJ0J30pO1xuICAgIHRoaXMucGMxLmNyZWF0ZU9mZmVyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RPZmZlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudCh7c3RhdGU6ICdlbmQnfSk7XG4gICAgdGhpcy5wYzEuY2xvc2UoKTtcbiAgICB0aGlzLnBjMi5jbG9zZSgpO1xuICB9LFxuXG4gIHNldEljZUNhbmRpZGF0ZUZpbHRlcjogZnVuY3Rpb24oZmlsdGVyKSB7XG4gICAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfID0gZmlsdGVyO1xuICB9LFxuXG4gIC8vIENvbnN0cmFpbnQgbWF4IHZpZGVvIGJpdHJhdGUgYnkgbW9kaWZ5aW5nIHRoZSBTRFAgd2hlbiBjcmVhdGluZyBhbiBhbnN3ZXIuXG4gIGNvbnN0cmFpblZpZGVvQml0cmF0ZTogZnVuY3Rpb24obWF4VmlkZW9CaXRyYXRlS2Jwcykge1xuICAgIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gPSBtYXhWaWRlb0JpdHJhdGVLYnBzO1xuICB9LFxuXG4gIC8vIFJlbW92ZSB2aWRlbyBGRUMgaWYgYXZhaWxhYmxlIG9uIHRoZSBvZmZlci5cbiAgZGlzYWJsZVZpZGVvRmVjOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNvbnN0cmFpbk9mZmVyVG9SZW1vdmVWaWRlb0ZlY18gPSB0cnVlO1xuICB9LFxuXG4gIC8vIFdoZW4gdGhlIHBlZXJDb25uZWN0aW9uIGlzIGNsb3NlZCB0aGUgc3RhdHNDYiBpcyBjYWxsZWQgb25jZSB3aXRoIGFuIGFycmF5XG4gIC8vIG9mIGdhdGhlcmVkIHN0YXRzLlxuICBnYXRoZXJTdGF0czogZnVuY3Rpb24ocGVlckNvbm5lY3Rpb24scGVlckNvbm5lY3Rpb24yLCBsb2NhbFN0cmVhbSwgc3RhdHNDYikge1xuICAgIHZhciBzdGF0cyA9IFtdO1xuICAgIHZhciBzdGF0czIgPSBbXTtcbiAgICB2YXIgc3RhdHNDb2xsZWN0VGltZSA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lMiA9IFtdO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgc3RhdFN0ZXBNcyA9IDEwMDtcbiAgICBzZWxmLmxvY2FsVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuICAgIHNlbGYucmVtb3RlVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuXG4gICAgcGVlckNvbm5lY3Rpb24uZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICBpZiAoc2VuZGVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgc2VsZi5sb2NhbFRyYWNrSWRzLmF1ZGlvID0gc2VuZGVyLnRyYWNrLmlkO1xuICAgICAgfSBlbHNlIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMudmlkZW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9XG4gICAgfS5iaW5kKHNlbGYpKTtcblxuICAgIGlmIChwZWVyQ29ubmVjdGlvbjIpIHtcbiAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRSZWNlaXZlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHJlY2VpdmVyKSB7XG4gICAgICAgIGlmIChyZWNlaXZlci50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcy5hdWRpbyA9IHJlY2VpdmVyLnRyYWNrLmlkO1xuICAgICAgICB9IGVsc2UgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLnZpZGVvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH1cbiAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSB0cnVlO1xuICAgIGdldFN0YXRzXygpO1xuXG4gICAgZnVuY3Rpb24gZ2V0U3RhdHNfKCkge1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uLnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICBzZWxmLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lLCBzdGF0czIsIHN0YXRzQ29sbGVjdFRpbWUyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGVlckNvbm5lY3Rpb24uZ2V0U3RhdHMoKVxuICAgICAgICAgIC50aGVuKGdvdFN0YXRzXylcbiAgICAgICAgICAuY2F0Y2goZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGdhdGhlciBzdGF0czogJyArIGVycm9yKTtcbiAgICAgICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lKTtcbiAgICAgICAgICB9LmJpbmQoc2VsZikpO1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgICBwZWVyQ29ubmVjdGlvbjIuZ2V0U3RhdHMoKVxuICAgICAgICAgICAgLnRoZW4oZ290U3RhdHMyXyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFN0YXRzIGZvciBwYzIsIHNvbWUgc3RhdHMgYXJlIG9ubHkgYXZhaWxhYmxlIG9uIHRoZSByZWNlaXZpbmcgZW5kIG9mIGFcbiAgICAvLyBwZWVyY29ubmVjdGlvbi5cbiAgICBmdW5jdGlvbiBnb3RTdGF0czJfKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0czIucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgICBmb3IgKHZhciBoIGluIHJlc3BvbnNlKSB7XG4gICAgICAgICAgdmFyIHN0YXQgPSByZXNwb25zZVtoXTtcbiAgICAgICAgICBzdGF0czIucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzXyhyZXNwb25zZSkge1xuICAgICAgLy8gVE9ETzogUmVtb3ZlIGJyb3dzZXIgc3BlY2lmaWMgc3RhdHMgZ2F0aGVyaW5nIGhhY2sgb25jZSBhZGFwdGVyLmpzIG9yXG4gICAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgICAgdmFyIGVudW1lcmF0ZWRTdGF0cyA9IGVudW1lcmF0ZVN0YXRzKHJlc3BvbnNlLCBzZWxmLmxvY2FsVHJhY2tJZHMsXG4gICAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzKTtcbiAgICAgICAgc3RhdHMucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGogaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2pdO1xuICAgICAgICAgIHN0YXRzLnB1c2goc3RhdCk7XG4gICAgICAgICAgc3RhdHNDb2xsZWN0VGltZS5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgICAgc2V0VGltZW91dChnZXRTdGF0c18sIHN0YXRTdGVwTXMpO1xuICAgIH1cbiAgfSxcblxuICBnb3RPZmZlcl86IGZ1bmN0aW9uKG9mZmVyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXykge1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoLyhtPXZpZGVvIDEgW15cXHJdKykoMTE2IDExNykoXFxyXFxuKS9nLFxuICAgICAgICAgICckMVxcclxcbicpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjExNiByZWRcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE3IHVscGZlY1xcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDo5OCBydHhcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1mbXRwOjk4IGFwdD0xMTZcXHJcXG4vZywgJycpO1xuICAgIH1cbiAgICB0aGlzLnBjMS5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5zZXRSZW1vdGVEZXNjcmlwdGlvbihvZmZlcik7XG4gICAgdGhpcy5wYzIuY3JlYXRlQW5zd2VyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RBbnN3ZXJfLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdClcbiAgICApO1xuICB9LFxuXG4gIGdvdEFuc3dlcl86IGZ1bmN0aW9uKGFuc3dlcikge1xuICAgIGlmICh0aGlzLmNvbnN0cmFpblZpZGVvQml0cmF0ZUticHNfKSB7XG4gICAgICBhbnN3ZXIuc2RwID0gYW5zd2VyLnNkcC5yZXBsYWNlKFxuICAgICAgICAgIC9hPW1pZDp2aWRlb1xcclxcbi9nLFxuICAgICAgICAgICdhPW1pZDp2aWRlb1xcclxcbmI9QVM6JyArIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gKyAnXFxyXFxuJyk7XG4gICAgfVxuICAgIHRoaXMucGMyLnNldExvY2FsRGVzY3JpcHRpb24oYW5zd2VyKTtcbiAgICB0aGlzLnBjMS5zZXRSZW1vdGVEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICB9LFxuXG4gIG9uSWNlQ2FuZGlkYXRlXzogZnVuY3Rpb24ob3RoZXJQZWVyLCBldmVudCkge1xuICAgIGlmIChldmVudC5jYW5kaWRhdGUpIHtcbiAgICAgIHZhciBwYXJzZWQgPSBDYWxsLnBhcnNlQ2FuZGlkYXRlKGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgaWYgKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyhwYXJzZWQpKSB7XG4gICAgICAgIG90aGVyUGVlci5hZGRJY2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbkNhbGwubm9GaWx0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5DYWxsLmlzUmVsYXkgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAncmVsYXknO1xufTtcblxuQ2FsbC5pc05vdEhvc3RDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlICE9PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzUmVmbGV4aXZlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ3NyZmx4Jztcbn07XG5cbkNhbGwuaXNIb3N0ID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ2hvc3QnO1xufTtcblxuQ2FsbC5pc0lwdjYgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS5hZGRyZXNzLmluZGV4T2YoJzonKSAhPT0gLTE7XG59O1xuXG4vLyBQYXJzZSBhICdjYW5kaWRhdGU6JyBsaW5lIGludG8gYSBKU09OIG9iamVjdC5cbkNhbGwucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHZhciBjYW5kaWRhdGVTdHIgPSAnY2FuZGlkYXRlOic7XG4gIHZhciBwb3MgPSB0ZXh0LmluZGV4T2YoY2FuZGlkYXRlU3RyKSArIGNhbmRpZGF0ZVN0ci5sZW5ndGg7XG4gIHZhciBmaWVsZHMgPSB0ZXh0LnN1YnN0cihwb3MpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgJ3R5cGUnOiBmaWVsZHNbN10sXG4gICAgJ3Byb3RvY29sJzogZmllbGRzWzJdLFxuICAgICdhZGRyZXNzJzogZmllbGRzWzRdXG4gIH07XG59O1xuXG4vLyBTdG9yZSB0aGUgSUNFIHNlcnZlciByZXNwb25zZSBmcm9tIHRoZSBuZXR3b3JrIHRyYXZlcnNhbCBzZXJ2ZXIuXG5DYWxsLmNhY2hlZEljZVNlcnZlcnNfID0gbnVsbDtcbi8vIEtlZXAgdHJhY2sgb2Ygd2hlbiB0aGUgcmVxdWVzdCB3YXMgbWFkZS5cbkNhbGwuY2FjaGVkSWNlQ29uZmlnRmV0Y2hUaW1lXyA9IG51bGw7XG5cbi8vIEdldCBhIFRVUk4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yLCBjdXJyZW50VGVzdCkge1xuICB2YXIgc2V0dGluZ3MgPSBjdXJyZW50VGVzdC5zZXR0aW5ncztcbiAgdmFyIGljZVNlcnZlciA9IHtcbiAgICAndXNlcm5hbWUnOiBzZXR0aW5ncy50dXJuVXNlcm5hbWUgfHwgJycsXG4gICAgJ2NyZWRlbnRpYWwnOiBzZXR0aW5ncy50dXJuQ3JlZGVudGlhbCB8fCAnJyxcbiAgICAndXJscyc6IHNldHRpbmdzLnR1cm5VUkkuc3BsaXQoJywnKVxuICB9O1xuICB2YXIgY29uZmlnID0geydpY2VTZXJ2ZXJzJzogW2ljZVNlcnZlcl19O1xuICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3R1cm4tY29uZmlnJywgY29uZmlnKTtcbiAgc2V0VGltZW91dChvblN1Y2Nlc3MuYmluZChudWxsLCBjb25maWcpLCAwKTtcbn07XG5cbi8vIEdldCBhIFNUVU4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVTdHVuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yKSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICB2YXIgaWNlU2VydmVyID0ge1xuICAgICd1cmxzJzogc2V0dGluZ3Muc3R1blVSSS5zcGxpdCgnLCcpXG4gIH07XG4gIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgnc3R1bi1jb25maWcnLCBjb25maWcpO1xuICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FsbDtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE3IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFNzaW0gZnJvbSAnLi9zc2ltLmpzJztcblxuZnVuY3Rpb24gVmlkZW9GcmFtZUNoZWNrZXIodmlkZW9FbGVtZW50KSB7XG4gIHRoaXMuZnJhbWVTdGF0cyA9IHtcbiAgICBudW1Gcm96ZW5GcmFtZXM6IDAsXG4gICAgbnVtQmxhY2tGcmFtZXM6IDAsXG4gICAgbnVtRnJhbWVzOiAwXG4gIH07XG5cbiAgdGhpcy5ydW5uaW5nXyA9IHRydWU7XG5cbiAgdGhpcy5ub25CbGFja1BpeGVsTHVtYVRocmVzaG9sZCA9IDIwO1xuICB0aGlzLnByZXZpb3VzRnJhbWVfID0gW107XG4gIHRoaXMuaWRlbnRpY2FsRnJhbWVTc2ltVGhyZXNob2xkID0gMC45ODU7XG4gIHRoaXMuZnJhbWVDb21wYXJhdG9yID0gbmV3IFNzaW0oKTtcblxuICB0aGlzLmNhbnZhc18gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdGhpcy52aWRlb0VsZW1lbnRfID0gdmlkZW9FbGVtZW50O1xuICB0aGlzLmxpc3RlbmVyXyA9IHRoaXMuY2hlY2tWaWRlb0ZyYW1lXy5iaW5kKHRoaXMpO1xuICB0aGlzLnZpZGVvRWxlbWVudF8uYWRkRXZlbnRMaXN0ZW5lcigncGxheScsIHRoaXMubGlzdGVuZXJfLCBmYWxzZSk7XG59XG5cblZpZGVvRnJhbWVDaGVja2VyLnByb3RvdHlwZSA9IHtcbiAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy52aWRlb0VsZW1lbnRfLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3BsYXknICwgdGhpcy5saXN0ZW5lcl8pO1xuICAgIHRoaXMucnVubmluZ18gPSBmYWxzZTtcbiAgfSxcblxuICBnZXRDdXJyZW50SW1hZ2VEYXRhXzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jYW52YXNfLndpZHRoID0gdGhpcy52aWRlb0VsZW1lbnRfLndpZHRoO1xuICAgIHRoaXMuY2FudmFzXy5oZWlnaHQgPSB0aGlzLnZpZGVvRWxlbWVudF8uaGVpZ2h0O1xuXG4gICAgdmFyIGNvbnRleHQgPSB0aGlzLmNhbnZhc18uZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBjb250ZXh0LmRyYXdJbWFnZSh0aGlzLnZpZGVvRWxlbWVudF8sIDAsIDAsIHRoaXMuY2FudmFzXy53aWR0aCxcbiAgICAgICAgdGhpcy5jYW52YXNfLmhlaWdodCk7XG4gICAgcmV0dXJuIGNvbnRleHQuZ2V0SW1hZ2VEYXRhKDAsIDAsIHRoaXMuY2FudmFzXy53aWR0aCwgdGhpcy5jYW52YXNfLmhlaWdodCk7XG4gIH0sXG5cbiAgY2hlY2tWaWRlb0ZyYW1lXzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmdfKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLnZpZGVvRWxlbWVudF8uZW5kZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaW1hZ2VEYXRhID0gdGhpcy5nZXRDdXJyZW50SW1hZ2VEYXRhXygpO1xuXG4gICAgaWYgKHRoaXMuaXNCbGFja0ZyYW1lXyhpbWFnZURhdGEuZGF0YSwgaW1hZ2VEYXRhLmRhdGEubGVuZ3RoKSkge1xuICAgICAgdGhpcy5mcmFtZVN0YXRzLm51bUJsYWNrRnJhbWVzKys7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZnJhbWVDb21wYXJhdG9yLmNhbGN1bGF0ZSh0aGlzLnByZXZpb3VzRnJhbWVfLCBpbWFnZURhdGEuZGF0YSkgPlxuICAgICAgICB0aGlzLmlkZW50aWNhbEZyYW1lU3NpbVRocmVzaG9sZCkge1xuICAgICAgdGhpcy5mcmFtZVN0YXRzLm51bUZyb3plbkZyYW1lcysrO1xuICAgIH1cbiAgICB0aGlzLnByZXZpb3VzRnJhbWVfID0gaW1hZ2VEYXRhLmRhdGE7XG5cbiAgICB0aGlzLmZyYW1lU3RhdHMubnVtRnJhbWVzKys7XG4gICAgc2V0VGltZW91dCh0aGlzLmNoZWNrVmlkZW9GcmFtZV8uYmluZCh0aGlzKSwgMjApO1xuICB9LFxuXG4gIGlzQmxhY2tGcmFtZV86IGZ1bmN0aW9uKGRhdGEsIGxlbmd0aCkge1xuICAgIC8vIFRPRE86IFVzZSBhIHN0YXRpc3RpY2FsLCBoaXN0b2dyYW0tYmFzZWQgZGV0ZWN0aW9uLlxuICAgIHZhciB0aHJlc2ggPSB0aGlzLm5vbkJsYWNrUGl4ZWxMdW1hVGhyZXNob2xkO1xuICAgIHZhciBhY2N1THVtYSA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDQ7IGkgPCBsZW5ndGg7IGkgKz0gNCkge1xuICAgICAgLy8gVXNlIEx1bWEgYXMgaW4gUmVjLiA3MDk6IFnigLI3MDkgPSAwLjIxUiArIDAuNzJHICsgMC4wN0I7XG4gICAgICBhY2N1THVtYSArPSAwLjIxICogZGF0YVtpXSArIDAuNzIgKiBkYXRhW2kgKyAxXSArIDAuMDcgKiBkYXRhW2kgKyAyXTtcbiAgICAgIC8vIEVhcmx5IHRlcm1pbmF0aW9uIGlmIHRoZSBhdmVyYWdlIEx1bWEgc28gZmFyIGlzIGJyaWdodCBlbm91Z2guXG4gICAgICBpZiAoYWNjdUx1bWEgPiAodGhyZXNoICogaSAvIDQpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn07XG5cbmlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBWaWRlb0ZyYW1lQ2hlY2tlcjtcbn1cbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IGFkYXB0ZXIgZnJvbSAnd2VicnRjLWFkYXB0ZXInO1xuaW1wb3J0IFJlcG9ydCBmcm9tICcuL3JlcG9ydC5qcyc7XG5pbXBvcnQgeyBlbnVtZXJhdGVTdGF0cyB9IGZyb20gJy4vdXRpbC5qcyc7XG5cbmNvbnN0IHJlcG9ydCA9IG5ldyBSZXBvcnQoKTtcblxuZnVuY3Rpb24gQ2FsbChjb25maWcsIHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy50cmFjZUV2ZW50ID0gcmVwb3J0LnRyYWNlRXZlbnRBc3luYygnY2FsbCcpO1xuICB0aGlzLnRyYWNlRXZlbnQoe2NvbmZpZzogY29uZmlnfSk7XG4gIHRoaXMuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG5cbiAgdGhpcy5wYzEgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcbiAgdGhpcy5wYzIgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcblxuICB0aGlzLnBjMS5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMikpO1xuICB0aGlzLnBjMi5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMSkpO1xuXG4gIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyA9IENhbGwubm9GaWx0ZXI7XG59XG5cbkNhbGwucHJvdG90eXBlID0ge1xuICBlc3RhYmxpc2hDb25uZWN0aW9uOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnQoe3N0YXRlOiAnc3RhcnQnfSk7XG4gICAgdGhpcy5wYzEuY3JlYXRlT2ZmZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdE9mZmVyXy5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpXG4gICAgKTtcbiAgfSxcblxuICBjbG9zZTogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ2VuZCd9KTtcbiAgICB0aGlzLnBjMS5jbG9zZSgpO1xuICAgIHRoaXMucGMyLmNsb3NlKCk7XG4gIH0sXG5cbiAgc2V0SWNlQ2FuZGlkYXRlRmlsdGVyOiBmdW5jdGlvbihmaWx0ZXIpIHtcbiAgICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBmaWx0ZXI7XG4gIH0sXG5cbiAgLy8gQ29uc3RyYWludCBtYXggdmlkZW8gYml0cmF0ZSBieSBtb2RpZnlpbmcgdGhlIFNEUCB3aGVuIGNyZWF0aW5nIGFuIGFuc3dlci5cbiAgY29uc3RyYWluVmlkZW9CaXRyYXRlOiBmdW5jdGlvbihtYXhWaWRlb0JpdHJhdGVLYnBzKSB7XG4gICAgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyA9IG1heFZpZGVvQml0cmF0ZUticHM7XG4gIH0sXG5cbiAgLy8gUmVtb3ZlIHZpZGVvIEZFQyBpZiBhdmFpbGFibGUgb24gdGhlIG9mZmVyLlxuICBkaXNhYmxlVmlkZW9GZWM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXyA9IHRydWU7XG4gIH0sXG5cbiAgLy8gV2hlbiB0aGUgcGVlckNvbm5lY3Rpb24gaXMgY2xvc2VkIHRoZSBzdGF0c0NiIGlzIGNhbGxlZCBvbmNlIHdpdGggYW4gYXJyYXlcbiAgLy8gb2YgZ2F0aGVyZWQgc3RhdHMuXG4gIGdhdGhlclN0YXRzOiBmdW5jdGlvbihwZWVyQ29ubmVjdGlvbixwZWVyQ29ubmVjdGlvbjIsIGxvY2FsU3RyZWFtLCBzdGF0c0NiKSB7XG4gICAgdmFyIHN0YXRzID0gW107XG4gICAgdmFyIHN0YXRzMiA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lID0gW107XG4gICAgdmFyIHN0YXRzQ29sbGVjdFRpbWUyID0gW107XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBzdGF0U3RlcE1zID0gMTAwO1xuICAgIHNlbGYubG9jYWxUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG4gICAgc2VsZi5yZW1vdGVUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG5cbiAgICBwZWVyQ29ubmVjdGlvbi5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMuYXVkaW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9IGVsc2UgaWYgKHNlbmRlci50cmFjay5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgIHNlbGYubG9jYWxUcmFja0lkcy52aWRlbyA9IHNlbmRlci50cmFjay5pZDtcbiAgICAgIH1cbiAgICB9LmJpbmQoc2VsZikpO1xuXG4gICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgcGVlckNvbm5lY3Rpb24yLmdldFJlY2VpdmVycygpLmZvckVhY2goZnVuY3Rpb24ocmVjZWl2ZXIpIHtcbiAgICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLmF1ZGlvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH0gZWxzZSBpZiAocmVjZWl2ZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMudmlkZW8gPSByZWNlaXZlci50cmFjay5pZDtcbiAgICAgICAgfVxuICAgICAgfS5iaW5kKHNlbGYpKTtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IHRydWU7XG4gICAgZ2V0U3RhdHNfKCk7XG5cbiAgICBmdW5jdGlvbiBnZXRTdGF0c18oKSB7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24uc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUsIHN0YXRzMiwgc3RhdHNDb2xsZWN0VGltZTIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwZWVyQ29ubmVjdGlvbi5nZXRTdGF0cygpXG4gICAgICAgICAgLnRoZW4oZ290U3RhdHNfKVxuICAgICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgc2VsZi50ZXN0LnJlcG9ydEVycm9yKCdDb3VsZCBub3QgZ2F0aGVyIHN0YXRzOiAnICsgZXJyb3IpO1xuICAgICAgICAgICAgc2VsZi5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUpO1xuICAgICAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24yKSB7XG4gICAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRTdGF0cygpXG4gICAgICAgICAgICAudGhlbihnb3RTdGF0czJfKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gU3RhdHMgZm9yIHBjMiwgc29tZSBzdGF0cyBhcmUgb25seSBhdmFpbGFibGUgb24gdGhlIHJlY2VpdmluZyBlbmQgb2YgYVxuICAgIC8vIHBlZXJjb25uZWN0aW9uLlxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzMl8ocmVzcG9uc2UpIHtcbiAgICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAgIHZhciBlbnVtZXJhdGVkU3RhdHMgPSBlbnVtZXJhdGVTdGF0cyhyZXNwb25zZSwgc2VsZi5sb2NhbFRyYWNrSWRzLFxuICAgICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcyk7XG4gICAgICAgIHN0YXRzMi5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGggaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2hdO1xuICAgICAgICAgIHN0YXRzMi5wdXNoKHN0YXQpO1xuICAgICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ290U3RhdHNfKHJlc3BvbnNlKSB7XG4gICAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0cy5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUucHVzaChEYXRlLm5vdygpKTtcbiAgICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgICAgZm9yICh2YXIgaiBpbiByZXNwb25zZSkge1xuICAgICAgICAgIHZhciBzdGF0ID0gcmVzcG9uc2Vbal07XG4gICAgICAgICAgc3RhdHMucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgICBzZXRUaW1lb3V0KGdldFN0YXRzXywgc3RhdFN0ZXBNcyk7XG4gICAgfVxuICB9LFxuXG4gIGdvdE9mZmVyXzogZnVuY3Rpb24ob2ZmZXIpIHtcbiAgICBpZiAodGhpcy5jb25zdHJhaW5PZmZlclRvUmVtb3ZlVmlkZW9GZWNfKSB7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvKG09dmlkZW8gMSBbXlxccl0rKSgxMTYgMTE3KShcXHJcXG4pL2csXG4gICAgICAgICAgJyQxXFxyXFxuJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE2IHJlZFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDoxMTcgdWxwZmVjXFwvOTAwMDBcXHJcXG4vZywgJycpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjk4IHJ0eFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPWZtdHA6OTggYXB0PTExNlxcclxcbi9nLCAnJyk7XG4gICAgfVxuICAgIHRoaXMucGMxLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIHRoaXMucGMyLnNldFJlbW90ZURlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5jcmVhdGVBbnN3ZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdEFuc3dlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgZ290QW5zd2VyXzogZnVuY3Rpb24oYW5zd2VyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18pIHtcbiAgICAgIGFuc3dlci5zZHAgPSBhbnN3ZXIuc2RwLnJlcGxhY2UoXG4gICAgICAgICAgL2E9bWlkOnZpZGVvXFxyXFxuL2csXG4gICAgICAgICAgJ2E9bWlkOnZpZGVvXFxyXFxuYj1BUzonICsgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyArICdcXHJcXG4nKTtcbiAgICB9XG4gICAgdGhpcy5wYzIuc2V0TG9jYWxEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICAgIHRoaXMucGMxLnNldFJlbW90ZURlc2NyaXB0aW9uKGFuc3dlcik7XG4gIH0sXG5cbiAgb25JY2VDYW5kaWRhdGVfOiBmdW5jdGlvbihvdGhlclBlZXIsIGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50LmNhbmRpZGF0ZSkge1xuICAgICAgdmFyIHBhcnNlZCA9IENhbGwucGFyc2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSk7XG4gICAgICBpZiAodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfKHBhcnNlZCkpIHtcbiAgICAgICAgb3RoZXJQZWVyLmFkZEljZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuQ2FsbC5ub0ZpbHRlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkNhbGwuaXNSZWxheSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgPT09ICdyZWxheSc7XG59O1xuXG5DYWxsLmlzTm90SG9zdENhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgIT09ICdob3N0Jztcbn07XG5cbkNhbGwuaXNSZWZsZXhpdmUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnc3JmbHgnO1xufTtcblxuQ2FsbC5pc0hvc3QgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzSXB2NiA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLmFkZHJlc3MuaW5kZXhPZignOicpICE9PSAtMTtcbn07XG5cbi8vIFBhcnNlIGEgJ2NhbmRpZGF0ZTonIGxpbmUgaW50byBhIEpTT04gb2JqZWN0LlxuQ2FsbC5wYXJzZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdmFyIGNhbmRpZGF0ZVN0ciA9ICdjYW5kaWRhdGU6JztcbiAgdmFyIHBvcyA9IHRleHQuaW5kZXhPZihjYW5kaWRhdGVTdHIpICsgY2FuZGlkYXRlU3RyLmxlbmd0aDtcbiAgdmFyIGZpZWxkcyA9IHRleHQuc3Vic3RyKHBvcykuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICAndHlwZSc6IGZpZWxkc1s3XSxcbiAgICAncHJvdG9jb2wnOiBmaWVsZHNbMl0sXG4gICAgJ2FkZHJlc3MnOiBmaWVsZHNbNF1cbiAgfTtcbn07XG5cbi8vIFN0b3JlIHRoZSBJQ0Ugc2VydmVyIHJlc3BvbnNlIGZyb20gdGhlIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuY2FjaGVkSWNlU2VydmVyc18gPSBudWxsO1xuLy8gS2VlcCB0cmFjayBvZiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBtYWRlLlxuQ2FsbC5jYWNoZWRJY2VDb25maWdGZXRjaFRpbWVfID0gbnVsbDtcblxuLy8gR2V0IGEgVFVSTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IsIGN1cnJlbnRUZXN0KSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICB2YXIgaWNlU2VydmVyID0ge1xuICAgICd1c2VybmFtZSc6IHNldHRpbmdzLnR1cm5Vc2VybmFtZSB8fCAnJyxcbiAgICAnY3JlZGVudGlhbCc6IHNldHRpbmdzLnR1cm5DcmVkZW50aWFsIHx8ICcnLFxuICAgICd1cmxzJzogc2V0dGluZ3MudHVyblVSSS5zcGxpdCgnLCcpXG4gIH07XG4gIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndHVybi1jb25maWcnLCBjb25maWcpO1xuICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xufTtcblxuLy8gR2V0IGEgU1RVTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVN0dW5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgdmFyIHNldHRpbmdzID0gY3VycmVudFRlc3Quc2V0dGluZ3M7XG4gIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgJ3VybHMnOiBzZXR0aW5ncy5zdHVuVVJJLnNwbGl0KCcsJylcbiAgfTtcbiAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IFtpY2VTZXJ2ZXJdfTtcbiAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCdzdHVuLWNvbmZpZycsIGNvbmZpZyk7XG4gIHNldFRpbWVvdXQob25TdWNjZXNzLmJpbmQobnVsbCwgY29uZmlnKSwgMCk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBDYWxsO1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4vKiBleHBvcnRlZCByZXBvcnQgKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gUmVwb3J0KCkge1xuICB0aGlzLm91dHB1dF8gPSBbXTtcbiAgdGhpcy5uZXh0QXN5bmNJZF8gPSAwO1xuXG4gIC8vIEhvb2sgY29uc29sZS5sb2cgaW50byB0aGUgcmVwb3J0LCBzaW5jZSB0aGF0IGlzIHRoZSBtb3N0IGNvbW1vbiBkZWJ1ZyB0b29sLlxuICB0aGlzLm5hdGl2ZUxvZ18gPSBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICBjb25zb2xlLmxvZyA9IHRoaXMubG9nSG9va18uYmluZCh0aGlzKTtcblxuICAvLyBIb29rIHVwIHdpbmRvdy5vbmVycm9yIGxvZ3MgaW50byB0aGUgcmVwb3J0LlxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCB0aGlzLm9uV2luZG93RXJyb3JfLmJpbmQodGhpcykpO1xuXG4gIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ3N5c3RlbS1pbmZvJywgUmVwb3J0LmdldFN5c3RlbUluZm8oKSk7XG59XG5cblJlcG9ydC5wcm90b3R5cGUgPSB7XG4gIHRyYWNlRXZlbnRJbnN0YW50OiBmdW5jdGlvbihuYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5vdXRwdXRfLnB1c2goeyd0cyc6IERhdGUubm93KCksXG4gICAgICAnbmFtZSc6IG5hbWUsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50V2l0aElkOiBmdW5jdGlvbihuYW1lLCBpZCwgYXJncykge1xuICAgIHRoaXMub3V0cHV0Xy5wdXNoKHsndHMnOiBEYXRlLm5vdygpLFxuICAgICAgJ25hbWUnOiBuYW1lLFxuICAgICAgJ2lkJzogaWQsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50QXN5bmM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy50cmFjZUV2ZW50V2l0aElkLmJpbmQodGhpcywgbmFtZSwgdGhpcy5uZXh0QXN5bmNJZF8rKyk7XG4gIH0sXG5cbiAgbG9nVGVzdFJ1blJlc3VsdDogZnVuY3Rpb24odGVzdE5hbWUsIHN0YXR1cykge1xuICAgIC8vIEdvb2dsZSBBbmFseXRpY3MgZXZlbnQgZm9yIHRoZSB0ZXN0IHJlc3VsdCB0byBhbGxvdyB0byB0cmFjayBob3cgdGhlXG4gICAgLy8gdGVzdCBpcyBkb2luZyBpbiB0aGUgd2lsZC5cbiAgICBnYSgnc2VuZCcsIHtcbiAgICAgICdoaXRUeXBlJzogJ2V2ZW50JyxcbiAgICAgICdldmVudENhdGVnb3J5JzogJ1Rlc3QnLFxuICAgICAgJ2V2ZW50QWN0aW9uJzogc3RhdHVzLFxuICAgICAgJ2V2ZW50TGFiZWwnOiB0ZXN0TmFtZSxcbiAgICAgICdub25JbnRlcmFjdGlvbic6IDFcbiAgICB9KTtcbiAgfSxcblxuICBnZW5lcmF0ZTogZnVuY3Rpb24oYnVnRGVzY3JpcHRpb24pIHtcbiAgICB2YXIgaGVhZGVyID0geyd0aXRsZSc6ICdXZWJSVEMgVHJvdWJsZXNob290ZXIgYnVnIHJlcG9ydCcsXG4gICAgICAnZGVzY3JpcHRpb24nOiBidWdEZXNjcmlwdGlvbiB8fCBudWxsfTtcbiAgICByZXR1cm4gdGhpcy5nZXRDb250ZW50XyhoZWFkZXIpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGxvZ3MgaW50byBhIEpTT04gZm9ybWF0ZWQgc3RyaW5nIHRoYXQgaXMgYSBsaXN0IG9mIGV2ZW50c1xuICAvLyBzaW1pbGFyIHRvIHRoZSB3YXkgY2hyb21lIGRldnRvb2xzIGZvcm1hdCB1c2VzLiBUaGUgZmluYWwgc3RyaW5nIGlzXG4gIC8vIG1hbnVhbGx5IGNvbXBvc2VkIHRvIGhhdmUgbmV3bGluZXMgYmV0d2VlbiB0aGUgZW50cmllcyBpcyBiZWluZyBlYXNpZXJcbiAgLy8gdG8gcGFyc2UgYnkgaHVtYW4gZXllcy4gSWYgYSBjb250ZW50SGVhZCBvYmplY3QgYXJndW1lbnQgaXMgcHJvdmlkZWQgaXRcbiAgLy8gd2lsbCBiZSBhZGRlZCBhdCB0aGUgdG9wIG9mIHRoZSBsb2cgZmlsZS5cbiAgZ2V0Q29udGVudF86IGZ1bmN0aW9uKGNvbnRlbnRIZWFkKSB7XG4gICAgdmFyIHN0cmluZ0FycmF5ID0gW107XG4gICAgdGhpcy5hcHBlbmRFdmVudHNBc1N0cmluZ18oW2NvbnRlbnRIZWFkXSB8fCBbXSwgc3RyaW5nQXJyYXkpO1xuICAgIHRoaXMuYXBwZW5kRXZlbnRzQXNTdHJpbmdfKHRoaXMub3V0cHV0Xywgc3RyaW5nQXJyYXkpO1xuICAgIHJldHVybiAnWycgKyBzdHJpbmdBcnJheS5qb2luKCcsXFxuJykgKyAnXSc7XG4gIH0sXG5cbiAgYXBwZW5kRXZlbnRzQXNTdHJpbmdfOiBmdW5jdGlvbihldmVudHMsIG91dHB1dCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSBldmVudHMubGVuZ3RoOyArK2kpIHtcbiAgICAgIG91dHB1dC5wdXNoKEpTT04uc3RyaW5naWZ5KGV2ZW50c1tpXSkpO1xuICAgIH1cbiAgfSxcblxuICBvbldpbmRvd0Vycm9yXzogZnVuY3Rpb24oZXJyb3IpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnRJbnN0YW50KCdlcnJvcicsIHsnbWVzc2FnZSc6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAnZmlsZW5hbWUnOiBlcnJvci5maWxlbmFtZSArICc6JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IubGluZW5vfSk7XG4gIH0sXG5cbiAgbG9nSG9va186IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ2xvZycsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy5uYXRpdmVMb2dfLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gIH1cbn07XG5cbi8qXG4gKiBEZXRlY3RzIHRoZSBydW5uaW5nIGJyb3dzZXIgbmFtZSwgdmVyc2lvbiBhbmQgcGxhdGZvcm0uXG4gKi9cblJlcG9ydC5nZXRTeXN0ZW1JbmZvID0gZnVuY3Rpb24oKSB7XG4gIC8vIENvZGUgaW5zcGlyZWQgYnkgaHR0cDovL2dvby5nbC85ZFpacUUgd2l0aFxuICAvLyBhZGRlZCBzdXBwb3J0IG9mIG1vZGVybiBJbnRlcm5ldCBFeHBsb3JlciB2ZXJzaW9ucyAoVHJpZGVudCkuXG4gIHZhciBhZ2VudCA9IG5hdmlnYXRvci51c2VyQWdlbnQ7XG4gIHZhciBicm93c2VyTmFtZSA9IG5hdmlnYXRvci5hcHBOYW1lO1xuICB2YXIgdmVyc2lvbiA9ICcnICsgcGFyc2VGbG9hdChuYXZpZ2F0b3IuYXBwVmVyc2lvbik7XG4gIHZhciBvZmZzZXROYW1lO1xuICB2YXIgb2Zmc2V0VmVyc2lvbjtcbiAgdmFyIGl4O1xuXG4gIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ0Nocm9tZScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdDaHJvbWUnO1xuICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDcpO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignTVNJRScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInOyAvLyBPbGRlciBJRSB2ZXJzaW9ucy5cbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyA1KTtcbiAgfSBlbHNlIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ1RyaWRlbnQnKSkgIT09IC0xKSB7XG4gICAgYnJvd3Nlck5hbWUgPSAnTWljcm9zb2Z0IEludGVybmV0IEV4cGxvcmVyJzsgLy8gTmV3ZXIgSUUgdmVyc2lvbnMuXG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgOCk7XG4gIH0gZWxzZSBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdGaXJlZm94JykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ0ZpcmVmb3gnO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignU2FmYXJpJykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ1NhZmFyaSc7XG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgNyk7XG4gICAgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignVmVyc2lvbicpKSAhPT0gLTEpIHtcbiAgICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDgpO1xuICAgIH1cbiAgfSBlbHNlIGlmICgob2Zmc2V0TmFtZSA9IGFnZW50Lmxhc3RJbmRleE9mKCcgJykgKyAxKSA8XG4gICAgICAgICAgICAgIChvZmZzZXRWZXJzaW9uID0gYWdlbnQubGFzdEluZGV4T2YoJy8nKSkpIHtcbiAgICAvLyBGb3Igb3RoZXIgYnJvd3NlcnMgJ25hbWUvdmVyc2lvbicgaXMgYXQgdGhlIGVuZCBvZiB1c2VyQWdlbnRcbiAgICBicm93c2VyTmFtZSA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXROYW1lLCBvZmZzZXRWZXJzaW9uKTtcbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyAxKTtcbiAgICBpZiAoYnJvd3Nlck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gYnJvd3Nlck5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgYnJvd3Nlck5hbWUgPSBuYXZpZ2F0b3IuYXBwTmFtZTtcbiAgICB9XG4gIH0gLy8gVHJpbSB0aGUgdmVyc2lvbiBzdHJpbmcgYXQgc2VtaWNvbG9uL3NwYWNlIGlmIHByZXNlbnQuXG4gIGlmICgoaXggPSB2ZXJzaW9uLmluZGV4T2YoJzsnKSkgIT09IC0xKSB7XG4gICAgdmVyc2lvbiA9IHZlcnNpb24uc3Vic3RyaW5nKDAsIGl4KTtcbiAgfVxuICBpZiAoKGl4ID0gdmVyc2lvbi5pbmRleE9mKCcgJykpICE9PSAtMSkge1xuICAgIHZlcnNpb24gPSB2ZXJzaW9uLnN1YnN0cmluZygwLCBpeCk7XG4gIH1cbiAgcmV0dXJuIHsnYnJvd3Nlck5hbWUnOiBicm93c2VyTmFtZSxcbiAgICAnYnJvd3NlclZlcnNpb24nOiB2ZXJzaW9uLFxuICAgICdwbGF0Zm9ybSc6IG5hdmlnYXRvci5wbGF0Zm9ybX07XG59O1xuXG5leHBvcnQgZGVmYXVsdCBSZXBvcnQ7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcblxuLyogVGhpcyBpcyBhbiBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgYWxnb3JpdGhtIGZvciBjYWxjdWxhdGluZyB0aGUgU3RydWN0dXJhbFxuICogU0lNaWxhcml0eSAoU1NJTSkgaW5kZXggYmV0d2VlbiB0d28gaW1hZ2VzLiBQbGVhc2UgcmVmZXIgdG8gdGhlIGFydGljbGUgWzFdLFxuICogdGhlIHdlYnNpdGUgWzJdIGFuZC9vciB0aGUgV2lraXBlZGlhIGFydGljbGUgWzNdLiBUaGlzIGNvZGUgdGFrZXMgdGhlIHZhbHVlXG4gKiBvZiB0aGUgY29uc3RhbnRzIEMxIGFuZCBDMiBmcm9tIHRoZSBNYXRsYWIgaW1wbGVtZW50YXRpb24gaW4gWzRdLlxuICpcbiAqIFsxXSBaLiBXYW5nLCBBLiBDLiBCb3ZpaywgSC4gUi4gU2hlaWtoLCBhbmQgRS4gUC4gU2ltb25jZWxsaSwgXCJJbWFnZSBxdWFsaXR5XG4gKiBhc3Nlc3NtZW50OiBGcm9tIGVycm9yIG1lYXN1cmVtZW50IHRvIHN0cnVjdHVyYWwgc2ltaWxhcml0eVwiLFxuICogSUVFRSBUcmFuc2FjdGlvbnMgb24gSW1hZ2UgUHJvY2Vzc2luZywgdm9sLiAxMywgbm8uIDEsIEphbi4gMjAwNC5cbiAqIFsyXSBodHRwOi8vd3d3LmNucy5ueXUuZWR1L35sY3Yvc3NpbS9cbiAqIFszXSBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1N0cnVjdHVyYWxfc2ltaWxhcml0eVxuICogWzRdIGh0dHA6Ly93d3cuY25zLm55dS5lZHUvfmxjdi9zc2ltL3NzaW1faW5kZXgubVxuICovXG5cbmZ1bmN0aW9uIFNzaW0oKSB7fVxuXG5Tc2ltLnByb3RvdHlwZSA9IHtcbiAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMiwgYSBzaW1wbGUgYXZlcmFnZSBvZiBhIHZlY3RvciBhbmQgRXEuNC4sIGV4Y2VwdCB0aGVcbiAgLy8gc3F1YXJlIHJvb3QuIFRoZSBsYXR0ZXIgaXMgYWN0dWFsbHkgYW4gdW5iaWFzZWQgZXN0aW1hdGUgb2YgdGhlIHZhcmlhbmNlLFxuICAvLyBub3QgdGhlIGV4YWN0IHZhcmlhbmNlLlxuICBzdGF0aXN0aWNzOiBmdW5jdGlvbihhKSB7XG4gICAgdmFyIGFjY3UgPSAwO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgKytpKSB7XG4gICAgICBhY2N1ICs9IGFbaV07XG4gICAgfVxuICAgIHZhciBtZWFuQSA9IGFjY3UgLyAoYS5sZW5ndGggLSAxKTtcbiAgICB2YXIgZGlmZiA9IDA7XG4gICAgZm9yIChpID0gMTsgaSA8IGEubGVuZ3RoOyArK2kpIHtcbiAgICAgIGRpZmYgPSBhW2kgLSAxXSAtIG1lYW5BO1xuICAgICAgYWNjdSArPSBhW2ldICsgKGRpZmYgKiBkaWZmKTtcbiAgICB9XG4gICAgcmV0dXJuIHttZWFuOiBtZWFuQSwgdmFyaWFuY2U6IGFjY3UgLyBhLmxlbmd0aH07XG4gIH0sXG5cbiAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMTEuLCBjb3YoWSwgWikgPSBFKChZIC0gdVkpLCAoWiAtIHVaKSkuXG4gIGNvdmFyaWFuY2U6IGZ1bmN0aW9uKGEsIGIsIG1lYW5BLCBtZWFuQikge1xuICAgIHZhciBhY2N1ID0gMDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGEubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGFjY3UgKz0gKGFbaV0gLSBtZWFuQSkgKiAoYltpXSAtIG1lYW5CKTtcbiAgICB9XG4gICAgcmV0dXJuIGFjY3UgLyBhLmxlbmd0aDtcbiAgfSxcblxuICBjYWxjdWxhdGU6IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICBpZiAoeC5sZW5ndGggIT09IHkubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICAvLyBWYWx1ZXMgb2YgdGhlIGNvbnN0YW50cyBjb21lIGZyb20gdGhlIE1hdGxhYiBjb2RlIHJlZmVycmVkIGJlZm9yZS5cbiAgICB2YXIgSzEgPSAwLjAxO1xuICAgIHZhciBLMiA9IDAuMDM7XG4gICAgdmFyIEwgPSAyNTU7XG4gICAgdmFyIEMxID0gKEsxICogTCkgKiAoSzEgKiBMKTtcbiAgICB2YXIgQzIgPSAoSzIgKiBMKSAqIChLMiAqIEwpO1xuICAgIHZhciBDMyA9IEMyIC8gMjtcblxuICAgIHZhciBzdGF0c1ggPSB0aGlzLnN0YXRpc3RpY3MoeCk7XG4gICAgdmFyIG11WCA9IHN0YXRzWC5tZWFuO1xuICAgIHZhciBzaWdtYVgyID0gc3RhdHNYLnZhcmlhbmNlO1xuICAgIHZhciBzaWdtYVggPSBNYXRoLnNxcnQoc2lnbWFYMik7XG4gICAgdmFyIHN0YXRzWSA9IHRoaXMuc3RhdGlzdGljcyh5KTtcbiAgICB2YXIgbXVZID0gc3RhdHNZLm1lYW47XG4gICAgdmFyIHNpZ21hWTIgPSBzdGF0c1kudmFyaWFuY2U7XG4gICAgdmFyIHNpZ21hWSA9IE1hdGguc3FydChzaWdtYVkyKTtcbiAgICB2YXIgc2lnbWFYeSA9IHRoaXMuY292YXJpYW5jZSh4LCB5LCBtdVgsIG11WSk7XG5cbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS42LlxuICAgIHZhciBsdW1pbmFuY2UgPSAoMiAqIG11WCAqIG11WSArIEMxKSAvXG4gICAgICAgICgobXVYICogbXVYKSArIChtdVkgKiBtdVkpICsgQzEpO1xuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjEwLlxuICAgIHZhciBzdHJ1Y3R1cmUgPSAoc2lnbWFYeSArIEMzKSAvIChzaWdtYVggKiBzaWdtYVkgKyBDMyk7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuOS5cbiAgICB2YXIgY29udHJhc3QgPSAoMiAqIHNpZ21hWCAqIHNpZ21hWSArIEMyKSAvIChzaWdtYVgyICsgc2lnbWFZMiArIEMyKTtcblxuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjEyLlxuICAgIHJldHVybiBsdW1pbmFuY2UgKiBjb250cmFzdCAqIHN0cnVjdHVyZTtcbiAgfVxufTtcblxuaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFNzaW07XG59XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gU3RhdGlzdGljc0FnZ3JlZ2F0ZShyYW1wVXBUaHJlc2hvbGQpIHtcbiAgdGhpcy5zdGFydFRpbWVfID0gMDtcbiAgdGhpcy5zdW1fID0gMDtcbiAgdGhpcy5jb3VudF8gPSAwO1xuICB0aGlzLm1heF8gPSAwO1xuICB0aGlzLnJhbXBVcFRocmVzaG9sZF8gPSByYW1wVXBUaHJlc2hvbGQ7XG4gIHRoaXMucmFtcFVwVGltZV8gPSBJbmZpbml0eTtcbn1cblxuU3RhdGlzdGljc0FnZ3JlZ2F0ZS5wcm90b3R5cGUgPSB7XG4gIGFkZDogZnVuY3Rpb24odGltZSwgZGF0YXBvaW50KSB7XG4gICAgaWYgKHRoaXMuc3RhcnRUaW1lXyA9PT0gMCkge1xuICAgICAgdGhpcy5zdGFydFRpbWVfID0gdGltZTtcbiAgICB9XG4gICAgdGhpcy5zdW1fICs9IGRhdGFwb2ludDtcbiAgICB0aGlzLm1heF8gPSBNYXRoLm1heCh0aGlzLm1heF8sIGRhdGFwb2ludCk7XG4gICAgaWYgKHRoaXMucmFtcFVwVGltZV8gPT09IEluZmluaXR5ICYmXG4gICAgICAgIGRhdGFwb2ludCA+IHRoaXMucmFtcFVwVGhyZXNob2xkXykge1xuICAgICAgdGhpcy5yYW1wVXBUaW1lXyA9IHRpbWU7XG4gICAgfVxuICAgIHRoaXMuY291bnRfKys7XG4gIH0sXG5cbiAgZ2V0QXZlcmFnZTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY291bnRfID09PSAwKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgucm91bmQodGhpcy5zdW1fIC8gdGhpcy5jb3VudF8pO1xuICB9LFxuXG4gIGdldE1heDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubWF4XztcbiAgfSxcblxuICBnZXRSYW1wVXBUaW1lOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZCh0aGlzLnJhbXBVcFRpbWVfIC0gdGhpcy5zdGFydFRpbWVfKTtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFN0YXRpc3RpY3NBZ2dyZWdhdGU7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0Jztcbi8qIGV4cG9ydGVkIGFycmF5QXZlcmFnZSwgYXJyYXlNYXgsIGFycmF5TWluLCBlbnVtZXJhdGVTdGF0cyAqL1xuXG4vLyBhcnJheTxmdW5jdGlvbj4gcmV0dXJucyB0aGUgYXZlcmFnZSAoZG93biB0byBuZWFyZXN0IGludCksIG1heCBhbmQgbWluIG9mXG4vLyBhbiBpbnQgYXJyYXkuXG5leHBvcnQgZnVuY3Rpb24gYXJyYXlBdmVyYWdlKGFycmF5KSB7XG4gIHZhciBjbnQgPSBhcnJheS5sZW5ndGg7XG4gIHZhciB0b3QgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGNudDsgaSsrKSB7XG4gICAgdG90ICs9IGFycmF5W2ldO1xuICB9XG4gIHJldHVybiBNYXRoLmZsb29yKHRvdCAvIGNudCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcnJheU1heChhcnJheSkge1xuICBpZiAoYXJyYXkubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIE5hTjtcbiAgfVxuICByZXR1cm4gTWF0aC5tYXguYXBwbHkoTWF0aCwgYXJyYXkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXJyYXlNaW4oYXJyYXkpIHtcbiAgaWYgKGFycmF5Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBOYU47XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluLmFwcGx5KE1hdGgsIGFycmF5KTtcbn1cblxuLy8gRW51bWVyYXRlcyB0aGUgbmV3IHN0YW5kYXJkIGNvbXBsaWFudCBzdGF0cyB1c2luZyBsb2NhbCBhbmQgcmVtb3RlIHRyYWNrIGlkcy5cbmV4cG9ydCBmdW5jdGlvbiBlbnVtZXJhdGVTdGF0cyhzdGF0cywgbG9jYWxUcmFja0lkcywgcmVtb3RlVHJhY2tJZHMpIHtcbiAgLy8gQ3JlYXRlIGFuIG9iamVjdCBzdHJ1Y3R1cmUgd2l0aCBhbGwgdGhlIG5lZWRlZCBzdGF0cyBhbmQgdHlwZXMgdGhhdCB3ZSBjYXJlXG4gIC8vIGFib3V0LiBUaGlzIGFsbG93cyB0byBtYXAgdGhlIGdldFN0YXRzIHN0YXRzIHRvIG90aGVyIHN0YXRzIG5hbWVzLlxuICB2YXIgc3RhdHNPYmplY3QgPSB7XG4gICAgYXVkaW86IHtcbiAgICAgIGxvY2FsOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgICBjbG9ja1JhdGU6IDAsXG4gICAgICAgIGNvZGVjSWQ6ICcnLFxuICAgICAgICBtaW1lVHlwZTogJycsXG4gICAgICAgIHBhY2tldHNTZW50OiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9LFxuICAgICAgcmVtb3RlOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogMCxcbiAgICAgICAgY2xvY2tSYXRlOiAwLFxuICAgICAgICBjb2RlY0lkOiAnJyxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBqaXR0ZXI6IDAsXG4gICAgICAgIG1pbWVUeXBlOiAnJyxcbiAgICAgICAgcGFja2V0c0xvc3Q6IC0xLFxuICAgICAgICBwYWNrZXRzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH1cbiAgICB9LFxuICAgIHZpZGVvOiB7XG4gICAgICBsb2NhbDoge1xuICAgICAgICBieXRlc1NlbnQ6IDAsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAwLFxuICAgICAgICBmcmFtZXNFbmNvZGVkOiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzU2VudDogLTEsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogMCxcbiAgICAgICAgcGFja2V0c1NlbnQ6IC0xLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IDAsXG4gICAgICAgIHFwU3VtOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH0sXG4gICAgICByZW1vdGU6IHtcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogLTEsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAtMSxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzRGVjb2RlZDogMCxcbiAgICAgICAgZnJhbWVzRHJvcHBlZDogMCxcbiAgICAgICAgZnJhbWVzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogLTEsXG4gICAgICAgIHBhY2tldHNMb3N0OiAtMSxcbiAgICAgICAgcGFja2V0c1JlY2VpdmVkOiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IC0xLFxuICAgICAgICBxcFN1bTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9XG4gICAgfSxcbiAgICBjb25uZWN0aW9uOiB7XG4gICAgICBhdmFpbGFibGVPdXRnb2luZ0JpdHJhdGU6IDAsXG4gICAgICBieXRlc1JlY2VpdmVkOiAwLFxuICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgY29uc2VudFJlcXVlc3RzU2VudDogMCxcbiAgICAgIGN1cnJlbnRSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgICBsb2NhbENhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIGxvY2FsQ2FuZGlkYXRlVHlwZTogJycsXG4gICAgICBsb2NhbElwOiAnJyxcbiAgICAgIGxvY2FsUG9ydDogMCxcbiAgICAgIGxvY2FsUHJpb3JpdHk6IDAsXG4gICAgICBsb2NhbFByb3RvY29sOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZVR5cGU6ICcnLFxuICAgICAgcmVtb3RlSXA6ICcnLFxuICAgICAgcmVtb3RlUG9ydDogMCxcbiAgICAgIHJlbW90ZVByaW9yaXR5OiAwLFxuICAgICAgcmVtb3RlUHJvdG9jb2w6ICcnLFxuICAgICAgcmVxdWVzdHNSZWNlaXZlZDogMCxcbiAgICAgIHJlcXVlc3RzU2VudDogMCxcbiAgICAgIHJlc3BvbnNlc1JlY2VpdmVkOiAwLFxuICAgICAgcmVzcG9uc2VzU2VudDogMCxcbiAgICAgIHRpbWVzdGFtcDogMC4wLFxuICAgICAgdG90YWxSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgfVxuICB9O1xuXG4gIC8vIE5lZWQgdG8gZmluZCB0aGUgY29kZWMsIGxvY2FsIGFuZCByZW1vdGUgSUQncyBmaXJzdC5cbiAgaWYgKHN0YXRzKSB7XG4gICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihyZXBvcnQsIHN0YXQpIHtcbiAgICAgIHN3aXRjaChyZXBvcnQudHlwZSkge1xuICAgICAgICBjYXNlICdvdXRib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy5hdWRpbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwucGFja2V0c1NlbnQgPSByZXBvcnQucGFja2V0c1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRpbWVzdGFtcCA9IHJlcG9ydC50aW1lc3RhbXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy52aWRlbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZmlyQ291bnQgPSByZXBvcnQuZmlyQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmZyYW1lc0VuY29kZWQgPSByZXBvcnQuZnJhbWVzRW5jb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYWNrZXRzU2VudCA9IHJlcG9ydC5wYWNrZXRzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwucGxpQ291bnQgPSByZXBvcnQucGxpQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50cmFja0lkID0gcmVwb3J0LnRyYWNrSWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnaW5ib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmZyYWN0aW9uTG9zdCA9IHJlcG9ydC5mcmFjdGlvbkxvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5qaXR0ZXIgPSByZXBvcnQuaml0dGVyO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGFja2V0c0xvc3QgPSByZXBvcnQucGFja2V0c0xvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5wYWNrZXRzUmVjZWl2ZWQgPSByZXBvcnQucGFja2V0c1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZpckNvdW50ID0gcmVwb3J0LmZpckNvdW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhY3Rpb25Mb3N0ID0gcmVwb3J0LmZyYWN0aW9uTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm5hY2tDb3VudCA9IHJlcG9ydC5uYWNrQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wYWNrZXRzTG9zdCA9IHJlcG9ydC5wYWNrZXRzTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnBhY2tldHNSZWNlaXZlZCA9IHJlcG9ydC5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wbGlDb3VudCA9IHJlcG9ydC5wbGlDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnY2FuZGlkYXRlLXBhaXInOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2F2YWlsYWJsZU91dGdvaW5nQml0cmF0ZScpKSB7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZSA9XG4gICAgICAgICAgICAgICAgcmVwb3J0LmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uYnl0ZXNSZWNlaXZlZCA9IHJlcG9ydC5ieXRlc1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5ieXRlc1NlbnQgPSByZXBvcnQuYnl0ZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5jb25zZW50UmVxdWVzdHNTZW50ID1cbiAgICAgICAgICAgICAgICByZXBvcnQuY29uc2VudFJlcXVlc3RzU2VudDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uY3VycmVudFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgIHJlcG9ydC5jdXJyZW50Um91bmRUcmlwVGltZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxDYW5kaWRhdGVJZCA9IHJlcG9ydC5sb2NhbENhbmRpZGF0ZUlkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVDYW5kaWRhdGVJZCA9IHJlcG9ydC5yZW1vdGVDYW5kaWRhdGVJZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVxdWVzdHNSZWNlaXZlZCA9IHJlcG9ydC5yZXF1ZXN0c1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXF1ZXN0c1NlbnQgPSByZXBvcnQucmVxdWVzdHNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXNwb25zZXNSZWNlaXZlZCA9IHJlcG9ydC5yZXNwb25zZXNSZWNlaXZlZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVzcG9uc2VzU2VudCA9IHJlcG9ydC5yZXNwb25zZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50b3RhbFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgcmVwb3J0LnRvdGFsUm91bmRUcmlwVGltZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0uYmluZCgpKTtcblxuICAgIC8vIFVzaW5nIHRoZSBjb2RlYywgbG9jYWwgYW5kIHJlbW90ZSBjYW5kaWRhdGUgSUQncyB0byBmaW5kIHRoZSByZXN0IG9mIHRoZVxuICAgIC8vIHJlbGV2YW50IHN0YXRzLlxuICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24ocmVwb3J0KSB7XG4gICAgICBzd2l0Y2gocmVwb3J0LnR5cGUpIHtcbiAgICAgICAgY2FzZSAndHJhY2snOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWRlbnRpZmllcicpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKGxvY2FsVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICBsb2NhbFRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZVdpZHRoID0gcmVwb3J0LmZyYW1lV2lkdGg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKHJlbW90ZVRyYWNrSWRzLnZpZGVvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgcmVtb3RlVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0RlY29kZWQgPSByZXBvcnQuZnJhbWVzRGVjb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0Ryb3BwZWQgPSByZXBvcnQuZnJhbWVzRHJvcHBlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc1JlY2VpdmVkID0gcmVwb3J0LmZyYW1lc1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVXaWR0aCA9IHJlcG9ydC5mcmFtZVdpZHRoO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkZW50aWZpZXIuaW5kZXhPZihsb2NhbFRyYWNrSWRzLmF1ZGlvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuYXVkaW9MZXZlbCA9IHJlcG9ydC5hdWRpb0xldmVsIDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQudHJhY2tJZGVudGlmaWVyLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmF1ZGlvTGV2ZWwgPSByZXBvcnQuYXVkaW9MZXZlbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2NvZGVjJzpcbiAgICAgICAgICBpZiAocmVwb3J0Lmhhc093blByb3BlcnR5KCdpZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdsb2NhbC1jYW5kaWRhdGUnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2lkJykpIHtcbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihcbiAgICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsSXAgPSByZXBvcnQuaXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQb3J0ID0gcmVwb3J0LnBvcnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbFByb3RvY29sID0gcmVwb3J0LnByb3RvY29sO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsVHlwZSA9IHJlcG9ydC5jYW5kaWRhdGVUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAncmVtb3RlLWNhbmRpZGF0ZSc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgnaWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKFxuICAgICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVtb3RlQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZUlwID0gcmVwb3J0LmlwO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVBvcnQgPSByZXBvcnQucG9ydDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcm90b2NvbCA9IHJlcG9ydC5wcm90b2NvbDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVUeXBlID0gcmVwb3J0LmNhbmRpZGF0ZVR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9LmJpbmQoKSk7XG4gIH1cbiAgcmV0dXJuIHN0YXRzT2JqZWN0O1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5pbXBvcnQgU3NpbSBmcm9tICcuL3NzaW0uanMnO1xuXG5mdW5jdGlvbiBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlb0VsZW1lbnQpIHtcbiAgdGhpcy5mcmFtZVN0YXRzID0ge1xuICAgIG51bUZyb3plbkZyYW1lczogMCxcbiAgICBudW1CbGFja0ZyYW1lczogMCxcbiAgICBudW1GcmFtZXM6IDBcbiAgfTtcblxuICB0aGlzLnJ1bm5pbmdfID0gdHJ1ZTtcblxuICB0aGlzLm5vbkJsYWNrUGl4ZWxMdW1hVGhyZXNob2xkID0gMjA7XG4gIHRoaXMucHJldmlvdXNGcmFtZV8gPSBbXTtcbiAgdGhpcy5pZGVudGljYWxGcmFtZVNzaW1UaHJlc2hvbGQgPSAwLjk4NTtcbiAgdGhpcy5mcmFtZUNvbXBhcmF0b3IgPSBuZXcgU3NpbSgpO1xuXG4gIHRoaXMuY2FudmFzXyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICB0aGlzLnZpZGVvRWxlbWVudF8gPSB2aWRlb0VsZW1lbnQ7XG4gIHRoaXMubGlzdGVuZXJfID0gdGhpcy5jaGVja1ZpZGVvRnJhbWVfLmJpbmQodGhpcyk7XG4gIHRoaXMudmlkZW9FbGVtZW50Xy5hZGRFdmVudExpc3RlbmVyKCdwbGF5JywgdGhpcy5saXN0ZW5lcl8sIGZhbHNlKTtcbn1cblxuVmlkZW9GcmFtZUNoZWNrZXIucHJvdG90eXBlID0ge1xuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnZpZGVvRWxlbWVudF8ucmVtb3ZlRXZlbnRMaXN0ZW5lcigncGxheScgLCB0aGlzLmxpc3RlbmVyXyk7XG4gICAgdGhpcy5ydW5uaW5nXyA9IGZhbHNlO1xuICB9LFxuXG4gIGdldEN1cnJlbnRJbWFnZURhdGFfOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNhbnZhc18ud2lkdGggPSB0aGlzLnZpZGVvRWxlbWVudF8ud2lkdGg7XG4gICAgdGhpcy5jYW52YXNfLmhlaWdodCA9IHRoaXMudmlkZW9FbGVtZW50Xy5oZWlnaHQ7XG5cbiAgICB2YXIgY29udGV4dCA9IHRoaXMuY2FudmFzXy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGNvbnRleHQuZHJhd0ltYWdlKHRoaXMudmlkZW9FbGVtZW50XywgMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLFxuICAgICAgICB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgICByZXR1cm4gY29udGV4dC5nZXRJbWFnZURhdGEoMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLCB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgfSxcblxuICBjaGVja1ZpZGVvRnJhbWVfOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucnVubmluZ18pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMudmlkZW9FbGVtZW50Xy5lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBpbWFnZURhdGEgPSB0aGlzLmdldEN1cnJlbnRJbWFnZURhdGFfKCk7XG5cbiAgICBpZiAodGhpcy5pc0JsYWNrRnJhbWVfKGltYWdlRGF0YS5kYXRhLCBpbWFnZURhdGEuZGF0YS5sZW5ndGgpKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXMrKztcbiAgICB9XG5cbiAgICBpZiAodGhpcy5mcmFtZUNvbXBhcmF0b3IuY2FsY3VsYXRlKHRoaXMucHJldmlvdXNGcmFtZV8sIGltYWdlRGF0YS5kYXRhKSA+XG4gICAgICAgIHRoaXMuaWRlbnRpY2FsRnJhbWVTc2ltVGhyZXNob2xkKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtRnJvemVuRnJhbWVzKys7XG4gICAgfVxuICAgIHRoaXMucHJldmlvdXNGcmFtZV8gPSBpbWFnZURhdGEuZGF0YTtcblxuICAgIHRoaXMuZnJhbWVTdGF0cy5udW1GcmFtZXMrKztcbiAgICBzZXRUaW1lb3V0KHRoaXMuY2hlY2tWaWRlb0ZyYW1lXy5iaW5kKHRoaXMpLCAyMCk7XG4gIH0sXG5cbiAgaXNCbGFja0ZyYW1lXzogZnVuY3Rpb24oZGF0YSwgbGVuZ3RoKSB7XG4gICAgLy8gVE9ETzogVXNlIGEgc3RhdGlzdGljYWwsIGhpc3RvZ3JhbS1iYXNlZCBkZXRlY3Rpb24uXG4gICAgdmFyIHRocmVzaCA9IHRoaXMubm9uQmxhY2tQaXhlbEx1bWFUaHJlc2hvbGQ7XG4gICAgdmFyIGFjY3VMdW1hID0gMDtcbiAgICBmb3IgKHZhciBpID0gNDsgaSA8IGxlbmd0aDsgaSArPSA0KSB7XG4gICAgICAvLyBVc2UgTHVtYSBhcyBpbiBSZWMuIDcwOTogWeKAsjcwOSA9IDAuMjFSICsgMC43MkcgKyAwLjA3QjtcbiAgICAgIGFjY3VMdW1hICs9IDAuMjEgKiBkYXRhW2ldICsgMC43MiAqIGRhdGFbaSArIDFdICsgMC4wNyAqIGRhdGFbaSArIDJdO1xuICAgICAgLy8gRWFybHkgdGVybWluYXRpb24gaWYgdGhlIGF2ZXJhZ2UgTHVtYSBzbyBmYXIgaXMgYnJpZ2h0IGVub3VnaC5cbiAgICAgIGlmIChhY2N1THVtYSA+ICh0aHJlc2ggKiBpIC8gNCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufTtcblxuaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFZpZGVvRnJhbWVDaGVja2VyO1xufVxuIl19
