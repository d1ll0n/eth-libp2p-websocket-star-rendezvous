/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const io = require('socket.io-client')
const multiaddr = require('multiaddr')
const uuid = require('uuid')

const rendezvous = require('../src')

describe('rendezvous', () => {
  const sioOptions = {
    transports: ['websocket'],
    'force new connection': true
  }

  let sioUrl
  let r
  let c1
  let c2
  let c3
  let c4

  let c1mh = multiaddr('/ip4/127.0.0.1/tcp/9090/ws/p2p-websocket-star/ipfs/W1p3KrTSzJXH3ujnGvNsYSP5bNvoUrfbmWfZDUnLH7Py11')
  let c2mh = multiaddr('/ip4/127.0.0.1/tcp/9090/ws/p2p-websocket-star/ipfs/W1p3KrTSzJXH3ujnGvNsYSP5bNvoUrfbmWfZDUnLH7Py12')
  let c3mh = multiaddr('/ip4/127.0.0.1/tcp/9090/ws/p2p-websocket-star/ipfs/W1p3KrTSzJXH3ujnGvNsYSP5bNvoUrfbmWfZDUnLH7Py13')
  let c4mh = multiaddr('/ip4/127.0.0.1/tcp/9090/ws/p2p-websocket-star/ipfs/W1p3KrTSzJXH3ujnGvNsYSP5bNvoUrfbmWfZDUnLH7Py14')

  it('start and stop signalling server (default port)', (done) => {
    rendezvous.start((err, server) => {
      expect(err).to.not.exist()
      expect(server.info.port).to.equal(13579)
      expect(server.info.protocol).to.equal('http')
      expect(server.info.address).to.equal('0.0.0.0')
      server.stop(done)
    })
  })

  it('start and stop signalling server (custom port)', (done) => {
    const options = {
      port: 12345
    }

    rendezvous.start(options, (err, server) => {
      expect(err).to.not.exist()
      expect(server.info.port).to.equal(12345)
      expect(server.info.protocol).to.equal('http')
      expect(server.info.address).to.equal('0.0.0.0')
      server.stop(done)
    })
  })

  it('start signalling server for client tests', (done) => {
    const options = {
      port: 12345,
      refreshPeerListIntervalMS: 1000,
      cryptoChallenge: false,
      strictMultiaddr: false,
      metrics: true
    }

    rendezvous.start(options, (err, server) => {
      expect(err).to.not.exist()
      expect(server.info.port).to.equal(12345)
      expect(server.info.protocol).to.equal('http')
      expect(server.info.address).to.equal('0.0.0.0')
      sioUrl = server.info.uri
      r = server
      done()
    })
  })

  it('zero peers', () => {
    expect(Object.keys(r.peers).length).to.equal(0)
  })

  it('connect one client', (done) => {
    c1 = io.connect(sioUrl, sioOptions)
    c1.on('connect', done)
  })

  it('connect three more clients', (done) => {
    let count = 0

    c2 = io.connect(sioUrl, sioOptions)
    c3 = io.connect(sioUrl, sioOptions)
    c4 = io.connect(sioUrl, sioOptions)

    c2.on('connect', connected)
    c3.on('connect', connected)
    c4.on('connect', connected)

    function connected () {
      if (++count === 3) {
        done()
      }
    }
  })

  it('ss-join first client', (done) => {
    c1.emit('ss-join', c1mh.toString(), '', (err, sig, peers) => {
      expect(err).to.not.exist()
      expect(peers).to.eql([])
      expect(Object.keys(r.peers()).length).to.equal(1)
      done()
    })
  })

  it('ss-join and ss-leave second client', (done) => {
    let c1WsPeerEvent
    c1.once('ws-peer', (p) => {
      c1WsPeerEvent = p
    })

    c2.emit('ss-join', c2mh.toString(), '', (err, sig, peers) => {
      expect(err).to.not.exist()
      expect(peers).to.eql([c1mh.toString()])
      expect(c1WsPeerEvent).to.equal(c2mh.toString())
      expect(Object.keys(r.peers()).length).to.equal(2)
      c2.emit('ss-leave', c2mh.toString())

      setTimeout(() => {
        expect(Object.keys(r.peers()).length).to.equal(1)
        done()
      }, 10)
    })
  })

  it('ss-join and disconnect third client', (done) => {
    c3.emit('ss-join', c3mh.toString(), '', (err, sig, peers) => {
      expect(err).to.not.exist()
      expect(peers).to.eql([c1mh.toString()])
      expect(Object.keys(r.peers()).length).to.equal(2)
      c3.disconnect()
      setTimeout(() => {
        expect(Object.keys(r.peers()).length).to.equal(1)
        done()
      }, 10)
    })
  })

  it('ss-join the fourth', (done) => {
    c1.once('ws-peer', (multiaddr) => {
      expect(multiaddr).to.equal(c4mh.toString())
      expect(Object.keys(r.peers()).length).to.equal(2)
      done()
    })
    c4.emit('ss-join', c4mh.toString(), '', () => {})
  })

  it('c1 dial c4', done => {
    const dialId = uuid()
    c4.once('ss-incomming', (dialId, dialFrom, cb) => {
      expect(dialId).to.eql(dialId)
      expect(dialFrom).to.eql(c1mh.toString())
      cb()
    })
    c1.emit('ss-dial', c1mh.toString(), c4mh.toString(), dialId, err => {
      expect(err).to.not.exist()
      done()
    })
  })

  it('c1 dial c2 fail (does not exist() anymore)', done => {
    const dialId = uuid()
    c1.emit('ss-dial', c1mh.toString(), c2mh.toString(), dialId, err => {
      expect(err).to.exist()
      done()
    })
  })

  it('disconnects every client', (done) => {
    [c1, c2, c3, c4].forEach((c) => c.disconnect())
    done()
  })

  it('emits ws-peer every second', (done) => {
    let peersEmitted = 0

    c1 = io.connect(sioUrl, sioOptions)
    c2 = io.connect(sioUrl, sioOptions)
    c1.emit('ss-join', '/ip4/0.0.0.0', '', err => expect(err).to.not.exist())
    c2.emit('ss-join', '/ip4/127.0.0.1', '', err => expect(err).to.not.exist())

    c1.on('ws-peer', (p) => {
      expect(p).to.be.equal('/ip4/127.0.0.1')
      check()
    })

    function check () {
      if (++peersEmitted === 2) {
        done()
      }
    }
  }).timeout(4000)

  it('stop signalling server', (done) => {
    c1.disconnect()
    c2.disconnect()
    r.stop(done)
  })
})
